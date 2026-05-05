function uniq(arr) {
  return Array.from(new Set(arr));
}

function normEmail(v) {
  return String(v || "").trim().toLowerCase();
}

function fmtTs(ts) {
  try {
    return new Date(Number(ts) || Date.now()).toISOString();
  } catch {
    return new Date().toISOString();
  }
}

function renderAlertMessage({ boatName, slug, event }) {
  const stateText = event.status === "active" ? "triggered" : "resolved";
  const title = `Alert: ${boatName} ${event.rule}`;
  const path = `/${slug}`;
  const ts = fmtTs(event.ts);
  const plain = `${boatName} ${event.rule} ${stateText}\nvalue=${event.value} threshold=${event.threshold}\n${ts}\n${path}`;
  const html = `<p><strong>${boatName}</strong> alert ${stateText}</p>
<p><strong>Rule:</strong> ${event.rule}</p>
<p><strong>Status:</strong> ${event.status}</p>
<p><strong>Value:</strong> ${event.value}</p>
<p><strong>Threshold:</strong> ${event.threshold}</p>
<p><strong>Timestamp:</strong> ${ts}</p>
<p><a href="${path}">${path}</a></p>`;
  const telegram = `${boatName}\n${event.rule} ${stateText}\nvalue ${event.value} / threshold ${event.threshold}\n${ts}\n${path}`;
  return { title, plain, html, telegram, path };
}

async function sendEmail({ recipients, subject, html }) {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.RESEND_FROM || "Hara Marina <onboarding@resend.dev>";
  if (!apiKey) {
    console.log(`[watchkeeper-email] No RESEND_API_KEY. Would send ${subject} to ${recipients.join(",")}`);
    return { ok: true, transport: "console" };
  }
  try {
    const r = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from,
        to: recipients,
        subject,
        html,
      }),
    });
    if (!r.ok) {
      const txt = await r.text();
      console.error("[watchkeeper-email] send failed:", r.status, txt);
      return { ok: false, transport: "email", error: txt };
    }
    return { ok: true, transport: "email" };
  } catch (e) {
    console.error("[watchkeeper-email] send failed:", e?.message || e);
    return { ok: false, transport: "email", error: e?.message || "email send failed" };
  }
}

async function sendTelegram({ chatId, text }) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) {
    console.warn("[watchkeeper-telegram] TELEGRAM_BOT_TOKEN not set");
    return { ok: false, transport: "telegram", error: "bot token missing" };
  }
  try {
    const r = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        disable_web_page_preview: true,
      }),
    });
    if (!r.ok) {
      const txt = await r.text();
      console.error("[watchkeeper-telegram] send failed:", r.status, txt);
      return { ok: false, transport: "telegram", error: txt };
    }
    return { ok: true, transport: "telegram" };
  } catch (e) {
    console.error("[watchkeeper-telegram] send failed:", e?.message || e);
    return { ok: false, transport: "telegram", error: e?.message || "telegram send failed" };
  }
}

export async function deliverWatchkeeperNotification({ settings, ownerEmail, boatName, slug, event }) {
  const sentChannels = [];
  const failures = [];

  const rendered = renderAlertMessage({ boatName, slug, event });
  const host = process.env.MARINA_PUBLIC_URL || process.env.NEXT_PUBLIC_SITE_URL || "";
  const baseUrl = host ? host.replace(/\/$/, "") : "";
  const html = baseUrl
    ? rendered.html.replace(`href="${rendered.path}"`, `href="${baseUrl}${rendered.path}"`)
    : rendered.html;
  const telegramText = baseUrl
    ? rendered.telegram.replace(rendered.path, `${baseUrl}${rendered.path}`)
    : rendered.telegram;

  const emailEnabled = settings?.notify_email_enabled !== false;
  if (emailEnabled) {
    const extra = Array.isArray(settings?.watchkeeper_recipients)
      ? settings.watchkeeper_recipients.map(normEmail).filter(Boolean)
      : [];
    const recipients = uniq([normEmail(ownerEmail), ...extra].filter(Boolean));
    if (recipients.length > 0) {
      const emailRes = await sendEmail({ recipients, subject: rendered.title, html });
      if (emailRes.ok) sentChannels.push("email");
      else failures.push(emailRes.error || "email failed");
    }
  }

  const telegramEnabled = !!settings?.notify_telegram_enabled;
  const chatId = String(settings?.telegram_chat_id || "").trim();
  if (telegramEnabled && chatId) {
    const tgRes = await sendTelegram({ chatId, text: telegramText });
    if (tgRes.ok) sentChannels.push("telegram");
    else failures.push(tgRes.error || "telegram failed");
  }

  return {
    ok: failures.length === 0,
    sentChannels,
    failures,
  };
}
