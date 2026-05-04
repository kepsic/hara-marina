import { useEffect, useMemo, useState } from "react";
import QRCode from "qrcode";
import { ModalShell } from "./SettingsModal";

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

export default function ShareModal({
  open, onClose, slug, boatName,
  shareTtlMin, setShareTtlMin,
  shareBusy, shareMsg, shareData, accessInfo,
  createShare,
}) {
  const [copied, setCopied] = useState("");
  const [qrUrl, setQrUrl] = useState("");

  // Determine which URL we share: prefer the freshly-created URL, otherwise the public boat URL.
  const publicUrl = useMemo(() => {
    if (typeof window === "undefined") return "";
    if (shareData?.shareUrl) return shareData.shareUrl;
    return `${window.location.origin}/${slug}`;
  }, [shareData, slug]);

  // Generate QR code whenever the shareable URL changes.
  useEffect(() => {
    if (!open || !publicUrl) { setQrUrl(""); return; }
    let alive = true;
    QRCode.toDataURL(publicUrl, {
      margin: 1, width: 240, color: { dark: "#0a1c2c", light: "#e8f4f8" },
    }).then((url) => { if (alive) setQrUrl(url); }).catch(() => { if (alive) setQrUrl(""); });
    return () => { alive = false; };
  }, [open, publicUrl]);

  const shareText = useMemo(() => {
    const parts = [`⚓ ${boatName} on Hara Marina`];
    if (shareData?.pin) parts.push(`PIN: ${shareData.pin}`);
    if (publicUrl) parts.push(publicUrl);
    return parts.join("\n");
  }, [boatName, shareData, publicUrl]);

  if (!open) return null;

  async function copy(text, key) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(key);
      setTimeout(() => setCopied(""), 1500);
    } catch {
      setCopied("error");
    }
  }

  const enc = encodeURIComponent;
  const socialLinks = [
    {
      key: "wa", label: "WhatsApp", color: "#25D366",
      href: `https://wa.me/?text=${enc(shareText)}`,
    },
    {
      key: "tg", label: "Telegram", color: "#229ED9",
      href: `https://t.me/share/url?url=${enc(publicUrl)}&text=${enc(`⚓ ${boatName}${shareData?.pin ? ` · PIN ${shareData.pin}` : ""}`)}`,
    },
    {
      key: "sms", label: "SMS", color: "#9ec8e0",
      href: `sms:?&body=${enc(shareText)}`,
    },
    {
      key: "mail", label: "Email", color: "#f0c040",
      href: `mailto:?subject=${enc(`${boatName} on Hara Marina`)}&body=${enc(shareText)}`,
    },
    {
      key: "fb", label: "Facebook", color: "#1877F2",
      href: `https://www.facebook.com/sharer/sharer.php?u=${enc(publicUrl)}`,
    },
    {
      key: "x", label: "X / Twitter", color: "#e8f4f8",
      href: `https://twitter.com/intent/tweet?text=${enc(`⚓ ${boatName}`)}&url=${enc(publicUrl)}`,
    },
  ];

  return (
    <ModalShell title={`🔗 Share · ${boatName || slug}`} onClose={onClose}>
      <div style={{ display: "grid", gridTemplateColumns: "240px 1fr", gap: 18, alignItems: "start" }}>
        <div>
          <div style={{
            background: "#e8f4f8", borderRadius: 8, padding: 8,
            display: "flex", alignItems: "center", justifyContent: "center",
            minHeight: 240, minWidth: 240,
          }}>
            {qrUrl
              ? <img src={qrUrl} alt={`QR for ${publicUrl}`} width={224} height={224} />
              : <span style={{ fontSize: 11, color: "#5a8aaa" }}>generating QR…</span>}
          </div>
          <div style={{
            fontSize: 9, letterSpacing: 2, color: "#7eabc8",
            textTransform: "uppercase", textAlign: "center", marginTop: 8,
          }}>
            {shareData ? "scan to open shared link" : "scan to open public link"}
          </div>
        </div>

        <div>
          <div style={{
            fontSize: 9, letterSpacing: 2, color: "#7eabc8",
            textTransform: "uppercase", marginBottom: 6,
          }}>Link</div>
          <div style={{
            fontFamily: "monospace", fontSize: 12, color: "#c8e0f0",
            background: "rgba(13,36,56,0.6)", border: "1px solid rgba(126,171,200,0.18)",
            borderRadius: 6, padding: "8px 10px", wordBreak: "break-all",
          }}>{publicUrl}</div>
          <div style={{ display: "flex", gap: 8, marginTop: 8, flexWrap: "wrap" }}>
            <button onClick={() => copy(publicUrl, "url")} style={btnGhost}>
              {copied === "url" ? "✓ copied" : "Copy link"}
            </button>
            {shareData?.pin && (
              <button onClick={() => copy(shareData.pin, "pin")} style={btnGhost}>
                {copied === "pin" ? "✓ copied" : `Copy PIN ${shareData.pin}`}
              </button>
            )}
            <button onClick={() => copy(shareText, "text")} style={btnGhost}>
              {copied === "text" ? "✓ copied" : "Copy message"}
            </button>
          </div>

          <div style={{
            fontSize: 9, letterSpacing: 2, color: "#7eabc8",
            textTransform: "uppercase", margin: "16px 0 6px",
          }}>Send via</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {socialLinks.map((s) => (
              <a key={s.key} href={s.href} target="_blank" rel="noreferrer noopener"
                 style={{
                   padding: "6px 10px", fontSize: 11, letterSpacing: 1,
                   borderRadius: 999,
                   background: "rgba(13,36,56,0.6)",
                   border: `1px solid ${s.color}55`,
                   color: s.color, textDecoration: "none",
                 }}>{s.label}</a>
            ))}
          </div>
        </div>
      </div>

      <div style={{
        marginTop: 18, padding: "12px 14px",
        background: "rgba(13,36,56,0.5)", borderRadius: 8,
        border: "1px solid rgba(126,171,200,0.15)",
      }}>
        <div style={{ fontSize: 9, letterSpacing: 2, color: "#7eabc8", textTransform: "uppercase", marginBottom: 8 }}>
          Temporary share link
        </div>
        <div style={{ fontSize: 11, color: "#9ec8e0", lineHeight: 1.5, marginBottom: 10 }}>
          Generates a one-time PIN-protected URL. Anyone with link + PIN can view the boat until it expires.
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <label style={{ fontSize: 11, color: "#7eabc8" }}>TTL (min)</label>
          <input value={shareTtlMin}
                 onChange={(e) => setShareTtlMin(Math.max(5, Math.min(1440, Number(e.target.value || 60))))}
                 type="number" min="5" max="1440"
                 style={{
                   width: 88, padding: "8px 10px", fontSize: 13,
                   background: "rgba(255,255,255,0.06)",
                   border: "1px solid rgba(126,171,200,0.25)",
                   color: "#e8f4f8", borderRadius: 6, outline: "none", fontFamily: "inherit",
                 }} />
          <button onClick={createShare} disabled={shareBusy} style={btnPrimary}>
            {shareBusy ? "Creating…" : (shareData ? "Refresh share" : "Create share")}
          </button>
          <span style={{ fontSize: 11, color: "#5a8aaa" }}>
            {shareMsg || (accessInfo?.activeShare
              ? `Active expires ${new Date(accessInfo.activeShare.expiresAtMs).toLocaleString()}`
              : "no active temporary share")}
          </span>
        </div>
        {shareData && (
          <div style={{ marginTop: 8, fontSize: 11, color: "#c8e0f0", lineHeight: 1.6 }}>
            <div>PIN: <strong>{shareData.pin}</strong></div>
            <div>Expires: {new Date(shareData.expiresAtMs).toLocaleString()}</div>
          </div>
        )}
      </div>
    </ModalShell>
  );
}
