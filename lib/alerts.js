import { Redis } from "./redis";
import { getBoatSettings } from "./boatSettings";
import { getAllOwnerSlugs, getOwnerEmail, norm } from "./owners";
import { deliverWatchkeeperNotification } from "./watchkeeperNotify";

const redis = new Redis();

const STATE_KEY = (slug) => `alert-state:${slug}`;
const HISTORY_KEY = (slug) => `alert-history:${slug}`;
const HISTORY_MAX = 100;

// Minimum gap between repeat notifications for the same active alert episode
// (after snooze expires, after restart, etc.). Prevents email spam.
const RENOTIFY_COOLDOWN_MS = 60 * 60 * 1000; // 1 hour

// Hard floor for the offline rule. Even if settings are corrupt or legacy data
// stored a smaller value, never evaluate offline with threshold below this.
const OFFLINE_MIN_THRESHOLD_MIN = 5;

const RULE_ALIASES = {
  bilge_alarm_cm: "high_bilge_cm",
  heel_alarm_deg: "high_heel_deg",
  depth_alarm_min_m: "low_depth_m",
  low_battery_v: "low_battery_v",
};

const RULES = [
  {
    rule: "low_battery_v",
    label: "low battery",
    thresholdKey: "low_battery_v",
    value: ({ telemetry }) => num(telemetry?.battery?.voltage),
    active: (value, threshold) => value < threshold,
  },
  {
    rule: "high_bilge_cm",
    label: "high bilge",
    thresholdKey: "bilge_alarm_cm",
    value: ({ telemetry }) => num(telemetry?.bilge?.water_cm),
    active: (value, threshold) => value > threshold,
  },
  {
    rule: "high_heel_deg",
    label: "high heel",
    thresholdKey: "heel_alarm_deg",
    value: ({ telemetry }) => {
      const v = num(telemetry?.heel_deg);
      return Number.isFinite(v) ? Math.abs(v) : null;
    },
    active: (value, threshold) => value > threshold,
  },
  {
    rule: "low_depth_m",
    label: "low depth",
    thresholdKey: "depth_alarm_min_m",
    value: ({ telemetry }) => num(telemetry?.water_depth_m),
    active: (value, threshold) => value < threshold,
  },
  {
    rule: "offline",
    label: "offline",
    thresholdKey: "offline_after_min",
    value: ({ nowTs, lastTelemetryTs }) => {
      if (!Number.isFinite(lastTelemetryTs)) return null;
      const diffMin = (nowTs - lastTelemetryTs) / 60000;
      return Number.isFinite(diffMin) ? Math.max(0, diffMin) : null;
    },
    // Defense-in-depth floor: nonsensical thresholds (0, negatives) would
    // otherwise cause the rule to fire whenever any time has elapsed since
    // the last packet — i.e. always. Floor here independent of settings parser.
    minThreshold: OFFLINE_MIN_THRESHOLD_MIN,
    active: (value, threshold) => value >= threshold,
  },
];

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function asTs(v, fallback = null) {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function asBool(v, fallback = false) {
  if (v === true || v === false) return v;
  return fallback;
}

function normalizeRuleId(rule) {
  const clean = String(rule || "").trim();
  return RULE_ALIASES[clean] || clean;
}

function displayBoatName(slug, settings) {
  return String(settings?.displayName || slug || "boat").trim();
}

function parseRuleState(raw) {
  if (!raw || typeof raw !== "object") return null;
  return {
    active: asBool(raw.active),
    first_triggered_ts: asTs(raw.first_triggered_ts),
    last_evaluated_ts: asTs(raw.last_evaluated_ts),
    last_notified_ts: asTs(raw.last_notified_ts),
    last_value: num(raw.last_value),
    threshold: num(raw.threshold),
    pending_trigger: asBool(raw.pending_trigger),
    pending_since: asTs(raw.pending_since),
    acked_at: asTs(raw.acked_at),
    snoozed_until: asTs(raw.snoozed_until),
    last_notified_channels: Array.isArray(raw.last_notified_channels)
      ? raw.last_notified_channels.map((x) => String(x || "")).filter(Boolean)
      : [],
  };
}

function defaultRuleState() {
  return {
    active: false,
    first_triggered_ts: null,
    last_evaluated_ts: null,
    last_notified_ts: null,
    last_value: null,
    threshold: null,
    pending_trigger: false,
    pending_since: null,
    acked_at: null,
    snoozed_until: null,
    last_notified_channels: [],
  };
}

function parseMeta(raw) {
  if (!raw || typeof raw !== "object") return { last_telemetry_ts: null, last_runner_ts: null };
  return {
    last_telemetry_ts: asTs(raw.last_telemetry_ts),
    last_runner_ts: asTs(raw.last_runner_ts),
  };
}

function parseSettings(raw) {
  const s = raw || {};
  return {
    watchkeeper_enabled: s.watchkeeper_enabled !== false,
    notify_email_enabled: s.notify_email_enabled !== false,
    notify_telegram_enabled: !!s.notify_telegram_enabled,
    offline_after_min: Number.isFinite(Number(s.offline_after_min)) ? Math.max(1, Number(s.offline_after_min)) : null,
    quiet_hours_enabled: !!s.quiet_hours_enabled,
    quiet_hours_start: String(s.quiet_hours_start || "22:00"),
    quiet_hours_end: String(s.quiet_hours_end || "07:00"),
    quiet_hours_tz: String(s.quiet_hours_tz || "Europe/Tallinn"),
    watchkeeper_recipients: Array.isArray(s.watchkeeper_recipients) ? s.watchkeeper_recipients : [],
    telegram_chat_id: s.telegram_chat_id || null,
  };
}

function localMinutes(ts, timeZone) {
  try {
    const fmt = new Intl.DateTimeFormat("en-GB", {
      timeZone,
      hour12: false,
      hour: "2-digit",
      minute: "2-digit",
    });
    const parts = fmt.formatToParts(new Date(ts));
    const h = Number(parts.find((p) => p.type === "hour")?.value || 0);
    const m = Number(parts.find((p) => p.type === "minute")?.value || 0);
    return (h * 60) + m;
  } catch {
    // Invalid IANA timezone — fall back to UTC so quiet hours are not silently enforced.
    console.warn(`[watchkeeper] invalid quiet_hours_tz "${timeZone}", falling back to UTC`);
    return new Date(ts).getUTCHours() * 60 + new Date(ts).getUTCMinutes();
  }
}

function parseHHMM(v) {
  const s = String(v || "").trim();
  const m = s.match(/^([01]\d|2[0-3]):([0-5]\d)$/);
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}

function isQuietHoursNow(nowTs, settings) {
  if (!settings.quiet_hours_enabled) return false;
  const start = parseHHMM(settings.quiet_hours_start);
  const end = parseHHMM(settings.quiet_hours_end);
  if (!Number.isFinite(start) || !Number.isFinite(end) || start === end) return false;
  const now = localMinutes(nowTs, settings.quiet_hours_tz || "Europe/Tallinn");
  if (start < end) return now >= start && now < end;
  return now >= start || now < end;
}

function buildStateFromHash(hash, rule) {
  const canonical = normalizeRuleId(rule);
  const current = parseRuleState(hash?.[canonical]);
  if (current) return current;
  if (canonical === rule) return null;
  return parseRuleState(hash?.[rule]);
}

function shouldSend({ nowTs, settings, row, isTriggerAttempt }) {
  if (!settings.watchkeeper_enabled) {
    return { send: false, reason: "watchkeeper-disabled" };
  }

  if (row.status === "resolved") {
    if (!row.prev.last_notified_ts) {
      return { send: false, reason: "no-prior-notify" };
    }
    return { send: true, reason: "resolved" };
  }

  if (!isTriggerAttempt) {
    return { send: false, reason: "not-trigger-attempt" };
  }

  if (!row.next.active) {
    return { send: false, reason: "not-active" };
  }

  // Acknowledged alerts suppress further deferred notifications.
  if (Number.isFinite(row.next.acked_at)) {
    return { send: false, reason: "acked" };
  }

  if (Number.isFinite(row.next.snoozed_until) && row.next.snoozed_until > nowTs) {
    return { send: false, reason: "snoozed" };
  }

  if (isQuietHoursNow(nowTs, settings)) {
    return { send: false, reason: "quiet-hours" };
  }

  // Anti-spam cooldown: if we've already sent a notification for this active
  // episode (i.e. last_notified_ts is set AND the rule has been continuously
  // active since first_triggered_ts <= last_notified_ts), require at least
  // RENOTIFY_COOLDOWN_MS to elapse before the next email. This prevents the
  // ack-cleared-by-resolution -> re-trigger -> re-notify loop and any other
  // path that would otherwise re-fire shortly after a prior send.
  if (Number.isFinite(row.next.last_notified_ts)
    && Number.isFinite(row.next.first_triggered_ts)
    && row.next.first_triggered_ts <= row.next.last_notified_ts
    && (nowTs - row.next.last_notified_ts) < RENOTIFY_COOLDOWN_MS) {
    return { send: false, reason: "renotify-cooldown" };
  }

  return { send: true, reason: "eligible" };
}

function logAlert(slug, rule, msg, extra) {
  const tail = extra ? ` ${JSON.stringify(extra)}` : "";
  console.log(`[watchkeeper] slug=${slug} rule=${rule} ${msg}${tail}`);
}

export function evaluateAlertRules({ telemetry, settings, previousByRule, nowTs, lastTelemetryTs }) {
  const out = [];
  for (const cfg of RULES) {
    const prev = buildStateFromHash(previousByRule, cfg.rule) || defaultRuleState();
    const thresholdRaw = cfg.thresholdKey === "offline_after_min"
      ? settings.offline_after_min
      : settings[cfg.thresholdKey];
    let threshold = num(thresholdRaw);
    // Apply per-rule minimum floor (e.g. offline must be >= 5 min) regardless
    // of what the stored setting says. Treat below-floor values as unset.
    if (Number.isFinite(threshold) && Number.isFinite(cfg.minThreshold) && threshold < cfg.minThreshold) {
      threshold = NaN;
    }
    const value = cfg.value({ telemetry, nowTs, lastTelemetryTs });

    if (!Number.isFinite(threshold)) {
      const next = {
        ...prev,
        active: false,
        threshold: null,
        last_value: value,
        last_evaluated_ts: nowTs,
        pending_trigger: false,
        pending_since: null,
        first_triggered_ts: null,
        acked_at: null,
        snoozed_until: null,
      };
      // If the rule was previously active but the threshold is now invalid
      // (cleared, set below floor, etc.), emit a resolved transition so the
      // alert clears cleanly instead of silently disappearing.
      const status = prev.active ? "resolved" : "unchanged";
      out.push({
        rule: cfg.rule,
        label: cfg.label,
        status,
        ignored: true,
        prev,
        next,
        value,
        threshold,
      });
      continue;
    }

    if (!Number.isFinite(value)) {
      const next = {
        ...prev,
        threshold,
        last_evaluated_ts: nowTs,
      };
      out.push({
        rule: cfg.rule,
        label: cfg.label,
        status: "unchanged",
        ignored: true,
        prev,
        next,
        value,
        threshold,
      });
      continue;
    }

    const activeNow = !!cfg.active(value, threshold);
    let status = "unchanged";
    if (!prev.active && activeNow) status = "active";
    if (prev.active && !activeNow) status = "resolved";

    const next = {
      ...prev,
      active: activeNow,
      first_triggered_ts: activeNow ? (prev.active ? (prev.first_triggered_ts || nowTs) : nowTs) : null,
      last_evaluated_ts: nowTs,
      last_value: value,
      threshold,
    };

    if (!activeNow) {
      next.pending_trigger = false;
      next.pending_since = null;
      next.acked_at = null;
      next.snoozed_until = null;
    }

    out.push({
      rule: cfg.rule,
      label: cfg.label,
      status,
      ignored: false,
      prev,
      next,
      value,
      threshold,
    });
  }
  return out;
}

function eventMessage(event) {
  const state = event.status === "active" ? "triggered" : "resolved";
  const t = Number.isFinite(event.threshold) ? event.threshold : "-";
  const v = Number.isFinite(event.value) ? Number(event.value).toFixed(2).replace(/\.00$/, "") : "-";
  return `${event.rule} ${state}: value=${v}, threshold=${t}`;
}

async function loadStateAndMeta(cleanSlug) {
  const hash = (await redis.hgetall(STATE_KEY(cleanSlug))) || {};
  const meta = parseMeta(hash._meta);
  return { hash, meta };
}

function chooseLastTelemetryTs(telemetry, meta) {
  const fromPayload = asTs(telemetry?.ts);
  if (fromPayload) return fromPayload;
  return asTs(meta?.last_telemetry_ts);
}

function shouldPatch(prev, next) {
  return JSON.stringify(prev || {}) !== JSON.stringify(next || {});
}

export async function evaluateAndNotifyAlerts(slug, telemetry, options = {}) {
  const cleanSlug = norm(slug || telemetry?.slug || "");
  if (!cleanSlug) return { ok: false, error: "slug required" };

  const nowTs = asTs(options.nowTs, Date.now()) || Date.now();
  const rawSettings = await getBoatSettings(cleanSlug);
  const settings = parseSettings(rawSettings);
  const { hash: previousByRule, meta } = await loadStateAndMeta(cleanSlug);
  const lastTelemetryTs = chooseLastTelemetryTs(telemetry, meta);

  const evaluations = evaluateAlertRules({
    telemetry,
    settings,
    previousByRule,
    nowTs,
    lastTelemetryTs,
  });

  const ownerEmail = getOwnerEmail(cleanSlug);
  const boatName = displayBoatName(cleanSlug, rawSettings);
  const statePatch = {};
  const eventsToHistory = [];
  let notified = 0;

  for (const row of evaluations) {
    const isDeferredTriggerAttempt = row.status === "unchanged" && row.next.active && (row.next.pending_trigger || !row.next.last_notified_ts);
    const decision = shouldSend({ nowTs, settings, row, isTriggerAttempt: isDeferredTriggerAttempt || row.status === "active" });

    if (row.status === "active" || isDeferredTriggerAttempt) {
      if (!decision.send) {
        if (decision.reason === "quiet-hours") {
          row.next.pending_trigger = true;
          row.next.pending_since = row.next.pending_since || nowTs;
          logAlert(cleanSlug, row.rule, "notification suppressed by quiet hours", { ts: nowTs });
        } else if (decision.reason === "snoozed") {
          row.next.pending_trigger = true;
          row.next.pending_since = row.next.pending_since || nowTs;
          logAlert(cleanSlug, row.rule, "notification suppressed by snooze", { snoozed_until: row.next.snoozed_until });
        } else if (decision.reason === "watchkeeper-disabled") {
          row.next.pending_trigger = true;
          row.next.pending_since = row.next.pending_since || nowTs;
          logAlert(cleanSlug, row.rule, "notification suppressed by watchkeeper disabled");
        }
      }
    }

    if (decision.send && (row.status === "active" || row.status === "resolved" || isDeferredTriggerAttempt)) {
      const status = row.status === "resolved" ? "resolved" : "active";
      // Dedup lock: prevent concurrent invocations (ingest + cron sweep) from
      // both firing the same notification. Key includes the active episode's
      // first_triggered_ts so a fresh episode after resolution is not blocked.
      // Resolved events use last_notified_ts as the episode anchor.
      const episodeAnchor = status === "active"
        ? (row.next.first_triggered_ts || nowTs)
        : (row.prev.last_notified_ts || nowTs);
      const lockKey = `notify-lock:${cleanSlug}:${row.rule}:${status}:${episodeAnchor}`;
      const lockAcquired = await redis.set(lockKey, nowTs, { ex: 120, nx: true });
      if (!lockAcquired) {
        logAlert(cleanSlug, row.rule, "notification skipped (dedup lock held)", { status, episodeAnchor });
      } else {
        const event = {
          rule: row.rule,
          status,
          ts: nowTs,
          value: row.next.last_value,
          threshold: row.next.threshold,
          acked_at: row.next.acked_at,
          snoozed_until: row.next.snoozed_until,
        };
        const delivery = await deliverWatchkeeperNotification({
          settings,
          ownerEmail,
          boatName,
          slug: cleanSlug,
          event,
        });

        if (delivery.sentChannels.length > 0) {
          row.next.last_notified_ts = nowTs;
          row.next.last_notified_channels = delivery.sentChannels;
          row.next.pending_trigger = false;
          row.next.pending_since = null;
          notified += 1;
          logAlert(cleanSlug, row.rule, "notification sent", { status, channels: delivery.sentChannels });
        } else {
          // Release lock on failure so a retry can attempt delivery.
          await redis.del(lockKey).catch(() => {});
          row.next.pending_trigger = status === "active" ? true : row.next.pending_trigger;
          logAlert(cleanSlug, row.rule, "notification skipped", { status, reason: decision.reason, failures: delivery.failures });
        }
      }
    }

    if (row.status === "active" || row.status === "resolved") {
      const event = {
        rule: row.rule,
        status: row.status,
        ts: nowTs,
        value: row.next.last_value,
        threshold: row.next.threshold,
        message: "",
        notified_channels: row.next.last_notified_ts === nowTs ? row.next.last_notified_channels : [],
        acked_at: row.next.acked_at,
        snoozed_until: row.next.snoozed_until,
      };
      event.message = eventMessage(event);
      eventsToHistory.push(event);
      logAlert(cleanSlug, row.rule, row.status, { value: event.value, threshold: event.threshold });
    }

    if (shouldPatch(row.prev, row.next)) {
      statePatch[row.rule] = row.next;
    }
  }

  const nextMeta = {
    last_telemetry_ts: lastTelemetryTs,
    last_runner_ts: nowTs,
  };
  if (shouldPatch(meta, nextMeta)) {
    statePatch._meta = nextMeta;
  }

  const writes = [];
  if (Object.keys(statePatch).length > 0) {
    writes.push(redis.hset(STATE_KEY(cleanSlug), statePatch));
  }
  for (const ev of eventsToHistory) {
    writes.push(redis.lpush(HISTORY_KEY(cleanSlug), ev));
  }
  if (eventsToHistory.length > 0) {
    writes.push(redis.ltrim(HISTORY_KEY(cleanSlug), 0, HISTORY_MAX - 1));
  }
  if (writes.length > 0) {
    await Promise.all(writes);
  }

  return {
    ok: true,
    slug: cleanSlug,
    results: evaluations,
    notified,
    last_telemetry_ts: nextMeta.last_telemetry_ts,
  };
}

export async function getAlertSnapshot(slug, historyLimit = HISTORY_MAX) {
  const cleanSlug = norm(slug || "");
  if (!cleanSlug) return { slug: cleanSlug, active: [], history: [], meta: {} };

  const settings = parseSettings(await getBoatSettings(cleanSlug));
  const { hash, meta } = await loadStateAndMeta(cleanSlug);
  const active = [];
  for (const cfg of RULES) {
    const s = buildStateFromHash(hash, cfg.rule);
    if (!s?.active) continue;
    active.push({
      rule: cfg.rule,
      label: cfg.label,
      status: "active",
      ts: s.first_triggered_ts,
      last_evaluated_ts: s.last_evaluated_ts,
      last_notified_ts: s.last_notified_ts,
      notified_channels: s.last_notified_channels || [],
      value: s.last_value,
      threshold: s.threshold,
      acked_at: s.acked_at,
      snoozed_until: s.snoozed_until,
      pending_trigger: !!s.pending_trigger,
    });
  }

  const capped = Math.max(1, Math.min(Number(historyLimit) || HISTORY_MAX, 500));
  const history = (await redis.lrange(HISTORY_KEY(cleanSlug), 0, capped - 1)) || [];

  return {
    slug: cleanSlug,
    active,
    history,
    meta: {
      last_telemetry_ts: meta.last_telemetry_ts,
      offline_after_min: settings.offline_after_min,
      watchkeeper_enabled: settings.watchkeeper_enabled,
      quiet_hours_enabled: settings.quiet_hours_enabled,
      quiet_hours_start: settings.quiet_hours_start,
      quiet_hours_end: settings.quiet_hours_end,
      quiet_hours_tz: settings.quiet_hours_tz,
    },
  };
}

export async function acknowledgeAlert(slug, rule, ackTs = Date.now()) {
  const cleanSlug = norm(slug || "");
  const cleanRule = normalizeRuleId(rule);
  if (!cleanSlug || !cleanRule) return { ok: false, error: "slug and rule required" };

  const { hash } = await loadStateAndMeta(cleanSlug);
  const prev = buildStateFromHash(hash, cleanRule) || defaultRuleState();
  if (!prev.active) {
    return { ok: false, error: "alert is not active" };
  }

  const next = {
    ...prev,
    acked_at: asTs(ackTs, Date.now()) || Date.now(),
    pending_trigger: false,
    pending_since: null,
  };
  await redis.hset(STATE_KEY(cleanSlug), { [cleanRule]: next });
  logAlert(cleanSlug, cleanRule, "acknowledged", { acked_at: next.acked_at });
  return { ok: true, rule: cleanRule, acked_at: next.acked_at };
}

export async function snoozeAlert(slug, rule, minutes, nowTs = Date.now()) {
  const cleanSlug = norm(slug || "");
  const cleanRule = normalizeRuleId(rule);
  if (!cleanSlug || !cleanRule) return { ok: false, error: "slug and rule required" };

  const mins = Math.min(Math.max(Math.round(Number(minutes) || 0), 1), 24 * 60);
  const { hash } = await loadStateAndMeta(cleanSlug);
  const prev = buildStateFromHash(hash, cleanRule) || defaultRuleState();
  if (!prev.active) {
    return { ok: false, error: "alert is not active" };
  }

  const until = (asTs(nowTs, Date.now()) || Date.now()) + (mins * 60000);
  const next = {
    ...prev,
    snoozed_until: until,
    pending_trigger: true,
    pending_since: prev.pending_since || (asTs(nowTs, Date.now()) || Date.now()),
  };
  await redis.hset(STATE_KEY(cleanSlug), { [cleanRule]: next });
  logAlert(cleanSlug, cleanRule, "snoozed", { snoozed_until: until });
  return { ok: true, rule: cleanRule, snoozed_until: until };
}

export async function runWatchkeeperSweep({ slugs, nowTs } = {}) {
  const list = Array.isArray(slugs) && slugs.length > 0
    ? slugs.map((s) => norm(s)).filter(Boolean)
    : getAllOwnerSlugs();
  const unique = Array.from(new Set(list));
  const at = asTs(nowTs, Date.now()) || Date.now();

  const results = [];
  for (const slug of unique) {
    try {
      const r = await evaluateAndNotifyAlerts(slug, null, { nowTs: at, source: "cron" });
      results.push({ slug, ok: true, notified: r.notified, last_telemetry_ts: r.last_telemetry_ts });
    } catch (e) {
      console.error("[watchkeeper] sweep failed:", slug, e?.message || e);
      results.push({ slug, ok: false, error: e?.message || "sweep failed" });
    }
  }

  return {
    ok: true,
    count: unique.length,
    results,
  };
}
