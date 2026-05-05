import { useEffect, useState } from "react";
import { EQUIPMENT_OPTIONS } from "../lib/constants";

const FIELD_STYLE = {
  width: "100%", padding: "8px 10px", fontSize: 13,
  background: "rgba(255,255,255,0.06)",
  border: "1px solid rgba(126,171,200,0.25)",
  color: "#e8f4f8", borderRadius: 6, outline: "none", fontFamily: "inherit",
};

const LABEL_STYLE = {
  fontSize: 9, letterSpacing: 2, color: "#7eabc8",
  textTransform: "uppercase", marginBottom: 4, display: "block",
};

function Field({ label, hint, children }) {
  return (
    <div style={{ marginBottom: 12 }}>
      <label style={LABEL_STYLE}>{label}</label>
      {children}
      {hint && <div style={{ fontSize: 10, color: "#5a8aaa", marginTop: 3 }}>{hint}</div>}
    </div>
  );
}

export default function SettingsModal({
  open, onClose, slug,
  // PIN management — handled by parent (uses existing hooks/state).
  ownerPin, setOwnerPin, ownerPinBusy, ownerPinMsg, saveOwnerPin, accessInfo,
  initialBoat,
  onSettingsSaved,
}) {
  const [tab, setTab] = useState("identity");
  const [s, setS] = useState({});
  const [loading, setLoading] = useState(false);
  const [saveBusy, setSaveBusy] = useState(false);
  const [msg, setMsg] = useState("");

  // Load settings on open.
  useEffect(() => {
    if (!open || !slug) return;
    let alive = true;
    setLoading(true); setMsg("");
    fetch(`/api/boats/${slug}/settings`)
      .then((r) => r.json())
      .then((j) => { if (alive) setS(j?.settings || {}); })
      .catch(() => { if (alive) setMsg("could not load settings"); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [open, slug]);

  if (!open) return null;

  const update = (k, v) => setS((prev) => ({ ...prev, [k]: v }));

  async function save() {
    setSaveBusy(true); setMsg("");
    try {
      const r = await fetch(`/api/boats/${slug}/settings`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(s),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j?.error || "save failed");
      setS(j.settings || {});
      setMsg("saved");
      onSettingsSaved?.(j.settings);
    } catch (e) {
      setMsg(e?.message || "save failed");
    } finally {
      setSaveBusy(false);
    }
  }

  return (
    <ModalShell title={`⚙ Boat Settings · ${initialBoat?.name || slug}`} onClose={onClose}>
      <div style={{ display: "flex", gap: 6, marginBottom: 14, flexWrap: "wrap" }}>
        {[
          { k: "identity", label: "Identity" },
          { k: "vessel",   label: "Vessel" },
          { k: "relays",   label: "Relays" },
          { k: "alarms",   label: "Alarms" },
          { k: "access",   label: "Access PIN" },
        ].map((t) => (
          <TabBtn key={t.k} active={tab === t.k} onClick={() => setTab(t.k)}>{t.label}</TabBtn>
        ))}
      </div>

      {loading && <div style={{ fontSize: 12, color: "#5a8aaa" }}>loading…</div>}

      {tab === "identity" && (
        <div>
          <Field label="Display name" hint="Visible on the boat page hero (does not change the slug or MQTT topic).">
            <input style={FIELD_STYLE} value={s.displayName || ""} placeholder={initialBoat?.name || ""}
                   onChange={(e) => update("displayName", e.target.value)} />
          </Field>
          <Field label="Owner / skipper">
            <input style={FIELD_STYLE} value={s.ownerName || ""} placeholder="e.g. Andres K."
                   onChange={(e) => update("ownerName", e.target.value)} />
          </Field>
          <Field label="Hull colour" hint="Hex colour used for the boat icon and accents.">
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <input type="color" value={s.color || initialBoat?.color || "#1a5a3a"}
                     onChange={(e) => update("color", e.target.value)}
                     style={{ width: 50, height: 36, border: "none", background: "transparent", cursor: "pointer" }} />
              <input style={{ ...FIELD_STYLE, flex: 1 }} value={s.color || ""} placeholder={initialBoat?.color || "#1a5a3a"}
                     onChange={(e) => update("color", e.target.value)} />
            </div>
          </Field>
          <Field label="Notes" hint="Anything you want to remember — model, marina cabinet, surveyor contact, etc.">
            <textarea style={{ ...FIELD_STYLE, minHeight: 80, fontFamily: "inherit", resize: "vertical" }}
                      value={s.notes || ""}
                      onChange={(e) => update("notes", e.target.value)} />
          </Field>
          <Field label="No battery monitor" hint="Hides battery widgets when this boat doesn't report battery state.">
            <label style={{ display: "flex", alignItems: "center", gap: 8, color: "#e8f4f8", fontSize: 13 }}>
              <input type="checkbox" checked={!!s.no_battery}
                     onChange={(e) => update("no_battery", e.target.checked)} />
              Hide battery
            </label>
          </Field>
          <Field label="AIS MMSI" hint="9-digit Maritime Mobile Service Identity from the boat's AIS transponder. Enables the AIS panel and MarineTraffic link.">
            <input style={FIELD_STYLE} value={s.mmsi || ""} placeholder="e.g. 276866556"
                   inputMode="numeric" maxLength={9}
                   onChange={(e) => update("mmsi", e.target.value.replace(/\D/g, "").slice(0, 9))} />
          </Field>
        </div>
      )}

      {tab === "relays" && (
        <RelaysTab labels={s.relay_labels || {}}
                   onChange={(next) => update("relay_labels", next)} />
      )}

      {tab === "vessel" && (
        <VesselTab s={s} update={update} />
      )}

      {tab === "alarms" && (
        <div>
          <div style={{ fontSize: 11, color: "#7eabc8", marginBottom: 14, lineHeight: 1.5 }}>
            These thresholds drive Watchkeeper alert notifications and visual warnings. Leave blank to disable each alert.
            Alert emails are sent to the registered owner address for this boat.
          </div>
          <Field label="Low water depth alarm (m)" hint="Warn when depth falls below this value.">
            <input type="number" step="0.1" style={FIELD_STYLE} value={s.depth_alarm_min_m ?? ""}
                   placeholder="e.g. 1.5"
                   onChange={(e) => update("depth_alarm_min_m", e.target.value === "" ? null : Number(e.target.value))} />
          </Field>
          <Field label="Excessive heel alarm (°)" hint="Warn when |heel| exceeds this angle.">
            <input type="number" step="1" style={FIELD_STYLE} value={s.heel_alarm_deg ?? ""}
                   placeholder="e.g. 25"
                   onChange={(e) => update("heel_alarm_deg", e.target.value === "" ? null : Number(e.target.value))} />
          </Field>
          <Field label="Bilge water alarm (cm)" hint="Warn when bilge water height exceeds this.">
            <input type="number" step="0.5" style={FIELD_STYLE} value={s.bilge_alarm_cm ?? ""}
                   placeholder="e.g. 4"
                   onChange={(e) => update("bilge_alarm_cm", e.target.value === "" ? null : Number(e.target.value))} />
          </Field>
          <Field label="Low battery voltage (V)" hint="Warn when battery falls below this voltage.">
            <input type="number" step="0.1" style={FIELD_STYLE} value={s.low_battery_v ?? ""}
                   placeholder="e.g. 12.0"
                   onChange={(e) => update("low_battery_v", e.target.value === "" ? null : Number(e.target.value))} />
          </Field>

          <div style={{ marginTop: 14, paddingTop: 10, borderTop: "1px solid rgba(126,171,200,0.18)" }}>
            <div style={{ fontSize: 10, letterSpacing: 2, color: "#7eabc8", textTransform: "uppercase", marginBottom: 10 }}>
              Watchkeeper Delivery
            </div>

            <Field label="Watchkeeper enabled">
              <label style={{ display: "flex", alignItems: "center", gap: 8, color: "#e8f4f8", fontSize: 13 }}>
                <input
                  type="checkbox"
                  checked={s.watchkeeper_enabled !== false}
                  onChange={(e) => update("watchkeeper_enabled", e.target.checked)}
                />
                Enable Watchkeeper notifications
              </label>
            </Field>

            <Field label="Offline after (minutes)" hint="Triggers offline alert if no telemetry arrives within this window.">
              <input
                type="number"
                step="1"
                min="1"
                style={FIELD_STYLE}
                value={s.offline_after_min ?? ""}
                placeholder="e.g. 30"
                onChange={(e) => update("offline_after_min", e.target.value === "" ? null : Number(e.target.value))}
              />
            </Field>

            <Field label="Email channel enabled">
              <label style={{ display: "flex", alignItems: "center", gap: 8, color: "#e8f4f8", fontSize: 13 }}>
                <input
                  type="checkbox"
                  checked={s.notify_email_enabled !== false}
                  onChange={(e) => update("notify_email_enabled", e.target.checked)}
                />
                Send emails
              </label>
            </Field>

            <Field label="Additional email recipients" hint="Comma or space separated. Owner email is always included.">
              <textarea
                style={{ ...FIELD_STYLE, minHeight: 52, resize: "vertical" }}
                value={Array.isArray(s.watchkeeper_recipients) ? s.watchkeeper_recipients.join(", ") : ""}
                placeholder="captain@example.com, crew@example.com"
                onChange={(e) => update(
                  "watchkeeper_recipients",
                  e.target.value
                    .split(/[\n,;\s]+/)
                    .map((x) => x.trim().toLowerCase())
                    .filter(Boolean),
                )}
              />
            </Field>

            <Field label="Telegram channel enabled">
              <label style={{ display: "flex", alignItems: "center", gap: 8, color: "#e8f4f8", fontSize: 13 }}>
                <input
                  type="checkbox"
                  checked={!!s.notify_telegram_enabled}
                  onChange={(e) => update("notify_telegram_enabled", e.target.checked)}
                />
                Send Telegram alerts
              </label>
            </Field>

            <Field label="Telegram chat ID">
              <input
                style={FIELD_STYLE}
                value={s.telegram_chat_id || ""}
                placeholder="e.g. -1001234567890"
                onChange={(e) => update("telegram_chat_id", e.target.value)}
              />
            </Field>

            <Field label="Quiet hours enabled">
              <label style={{ display: "flex", alignItems: "center", gap: 8, color: "#e8f4f8", fontSize: 13 }}>
                <input
                  type="checkbox"
                  checked={!!s.quiet_hours_enabled}
                  onChange={(e) => update("quiet_hours_enabled", e.target.checked)}
                />
                Suppress trigger notifications during quiet hours
              </label>
            </Field>

            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 10 }}>
              <Field label="Quiet start (HH:MM)">
                <input
                  style={FIELD_STYLE}
                  value={s.quiet_hours_start || ""}
                  placeholder="22:00"
                  onChange={(e) => update("quiet_hours_start", e.target.value)}
                />
              </Field>
              <Field label="Quiet end (HH:MM)">
                <input
                  style={FIELD_STYLE}
                  value={s.quiet_hours_end || ""}
                  placeholder="07:00"
                  onChange={(e) => update("quiet_hours_end", e.target.value)}
                />
              </Field>
            </div>

            <Field label="Quiet hours timezone">
              <input
                style={FIELD_STYLE}
                value={s.quiet_hours_tz || "Europe/Tallinn"}
                placeholder="Europe/Tallinn"
                onChange={(e) => update("quiet_hours_tz", e.target.value)}
              />
            </Field>
          </div>
        </div>
      )}

      {tab === "access" && (
        <div>
          <div style={{ fontSize: 11, color: "#7eabc8", marginBottom: 14, lineHeight: 1.5 }}>
            Set a permanent PIN that lets non-owner visitors unlock <strong>/{slug}</strong> without signing in.
          </div>
          <form onSubmit={saveOwnerPin} style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <input
              value={ownerPin}
              onChange={(e) => setOwnerPin(e.target.value.replace(/\D/g, "").slice(0, 10))}
              placeholder="4-10 digit PIN"
              inputMode="numeric"
              style={{ ...FIELD_STYLE, flex: "1 1 160px" }}
            />
            <button type="submit" disabled={ownerPinBusy || ownerPin.length < 4}
              style={{
                padding: "8px 12px", cursor: "pointer",
                background: ownerPinBusy ? "rgba(126,171,200,0.15)" : "#f0c040",
                color: ownerPinBusy ? "#7eabc8" : "#091820",
                border: "none", borderRadius: 6, fontSize: 12, letterSpacing: 1, fontWeight: "bold", fontFamily: "inherit",
              }}>
              {ownerPinBusy ? "Saving…" : (accessInfo?.ownerPinSet ? "Update PIN" : "Set PIN")}
            </button>
          </form>
          <div style={{ fontSize: 11, color: ownerPinMsg === "PIN saved" ? "#9eddb0" : "#5a8aaa", marginTop: 8 }}>
            {ownerPinMsg || (accessInfo?.ownerPinSet ? "PIN is configured" : "PIN not set yet")}
          </div>
        </div>
      )}

      {tab !== "access" && (
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 18, gap: 12 }}>
          <span style={{ fontSize: 11, color: msg === "saved" ? "#9eddb0" : "#5a8aaa" }}>{msg}</span>
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={onClose} style={btnGhost}>Close</button>
            <button onClick={save} disabled={saveBusy} style={btnPrimary}>
              {saveBusy ? "Saving…" : "Save settings"}
            </button>
          </div>
        </div>
      )}
    </ModalShell>
  );
}

function TabBtn({ active, children, onClick }) {
  return (
    <button onClick={onClick} style={{
      background: active ? "rgba(158,200,224,0.18)" : "transparent",
      border: `1px solid ${active ? "rgba(158,200,224,0.5)" : "rgba(126,171,200,0.18)"}`,
      color: active ? "#e8f4f8" : "#9ec8e0",
      borderRadius: 6, padding: "6px 12px", fontSize: 11, letterSpacing: 1,
      textTransform: "uppercase", cursor: "pointer", fontFamily: "inherit",
    }}>{children}</button>
  );
}

function VesselTab({ s, update }) {
  const equipment = Array.isArray(s.equipment) ? s.equipment : [];
  const toggle = (item) => {
    const next = equipment.includes(item)
      ? equipment.filter((x) => x !== item)
      : [...equipment, item];
    update("equipment", next);
  };
  const numField = (k) => (s[k] === null || s[k] === undefined ? "" : String(s[k]));
  const setNum = (k, v) => update(k, v === "" ? null : v);
  return (
    <div>
      <div style={{ fontSize: 11, color: "#7eabc8", marginBottom: 14, lineHeight: 1.5 }}>
        Vessel specs shown on the public boat page and in the marina overview.
      </div>
      <Field label="Vessel model">
        <input style={FIELD_STYLE} value={s.model || ""} placeholder="e.g. Beneteau First 35"
               onChange={(e) => update("model", e.target.value)} />
      </Field>
      <div style={{ display: "flex", gap: 8 }}>
        <div style={{ flex: 1 }}>
          <Field label="Length m">
            <input style={FIELD_STYLE} type="number" step="0.1" min="0" inputMode="decimal"
                   value={numField("length_m")} placeholder="10.5"
                   onChange={(e) => setNum("length_m", e.target.value)} />
          </Field>
        </div>
        <div style={{ flex: 1 }}>
          <Field label="Beam m">
            <input style={FIELD_STYLE} type="number" step="0.1" min="0" inputMode="decimal"
                   value={numField("beam_m")} placeholder="3.4"
                   onChange={(e) => setNum("beam_m", e.target.value)} />
          </Field>
        </div>
        <div style={{ flex: 1 }}>
          <Field label="Draft m">
            <input style={FIELD_STYLE} type="number" step="0.1" min="0" inputMode="decimal"
                   value={numField("draft_m")} placeholder="1.8"
                   onChange={(e) => setNum("draft_m", e.target.value)} />
          </Field>
        </div>
      </div>
      <Field label="Engine">
        <input style={FIELD_STYLE} value={s.engine || ""} placeholder="Volvo D2-40"
               onChange={(e) => update("engine", e.target.value)} />
      </Field>
      <Field label="Equipment" hint="Tap to toggle. These appear as tags on the boat page.">
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
          {EQUIPMENT_OPTIONS.map((item) => {
            const on = equipment.includes(item);
            return (
              <button key={item} type="button" onClick={() => toggle(item)} style={{
                padding: "4px 9px", fontSize: 11, borderRadius: 4, cursor: "pointer",
                background: on ? "rgba(240,192,64,0.18)" : "rgba(255,255,255,0.04)",
                color: on ? "#f0c040" : "#9ec8e0",
                border: `1px solid ${on ? "rgba(240,192,64,0.55)" : "rgba(126,171,200,0.25)"}`,
                fontFamily: "inherit",
              }}>{item}</button>
            );
          })}
        </div>
      </Field>
    </div>
  );
}

function RelaysTab({ labels, onChange }) {
  const set = (n, v) => {
    const next = { ...labels };
    const trimmed = v.slice(0, 40);
    if (trimmed.trim()) next[String(n)] = trimmed;
    else delete next[String(n)];
    onChange(next);
  };
  return (
    <div>
      <div style={{ fontSize: 11, color: "#7eabc8", marginBottom: 14, lineHeight: 1.5 }}>
        Friendly names for each relay channel. These appear under the manual toggle buttons
        and in scenario dropdowns. Leave blank to keep the default <code style={{color:"#9ec8e0"}}>R1…R4</code>.
      </div>
      {[1,2,3,4].map((n) => (
        <Field key={n} label={`Relay ${n}`}>
          <input style={FIELD_STYLE} value={labels[String(n)] || ""}
                 placeholder={`e.g. ${["Heater","Cabin lights","Fridge","Bilge pump"][n-1]}`}
                 onChange={(e) => set(n, e.target.value)} />
        </Field>
      ))}
    </div>
  );
}

const btnPrimary = {
  padding: "8px 14px", cursor: "pointer", background: "#f0c040",
  color: "#091820", border: "none", borderRadius: 6,
  fontSize: 12, letterSpacing: 1, fontWeight: "bold", fontFamily: "inherit",
};

const btnGhost = {
  padding: "8px 14px", cursor: "pointer", background: "transparent",
  color: "#9ec8e0", border: "1px solid rgba(126,171,200,0.3)", borderRadius: 6,
  fontSize: 12, letterSpacing: 1, fontFamily: "inherit",
};

export function ModalShell({ title, children, onClose }) {
  // Close on Escape.
  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape") onClose?.(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div onClick={onClose} style={{
      position: "fixed", inset: 0, background: "rgba(7,21,32,0.78)",
      zIndex: 1000, display: "flex", alignItems: "flex-start", justifyContent: "center",
      padding: "60px 16px", overflowY: "auto",
    }}>
      <div onClick={(e) => e.stopPropagation()} style={{
        width: "100%", maxWidth: 540,
        background: "linear-gradient(180deg, #0c2235, #112a3f)",
        border: "1px solid rgba(126,171,200,0.25)",
        borderRadius: 10, padding: "18px 20px 20px",
        boxShadow: "0 24px 60px rgba(0,0,0,0.45)",
        color: "#e8f4f8", fontFamily: "'Georgia','Times New Roman',serif",
      }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
          <div style={{ fontSize: 13, letterSpacing: 2, color: "#e8f4f8", textTransform: "uppercase" }}>{title}</div>
          <button onClick={onClose} aria-label="Close" style={{
            background: "transparent", border: "none", color: "#7eabc8", fontSize: 20, cursor: "pointer", padding: 0,
          }}>×</button>
        </div>
        {children}
      </div>
    </div>
  );
}
