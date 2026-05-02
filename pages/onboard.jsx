import { useEffect, useState } from "react";
import Head from "next/head";
import Link from "next/link";

const SOURCES = [
  { id: "cerbo",  label: "Victron Cerbo GX",            note: "Reads from the Cerbo's onboard MQTT broker (port 1883)." },
  { id: "ydwg",   label: "Yacht Devices NMEA2000 Wi-Fi", note: "YDWG-02 / YDEN-02 RAW NMEA2000 over TCP." },
  { id: "both",   label: "Cerbo GX + Yacht Devices",     note: "Merge both feeds (Cerbo wins on conflicts)." },
  { id: "custom", label: "Custom (HTTP only)",            note: "Skip the bridge — POST telemetry directly to the ingest URL." },
];

const card = {
  background: "linear-gradient(180deg, rgba(13,36,56,0.6), rgba(9,28,44,0.6))",
  border: "1px solid rgba(126,171,200,0.18)",
  borderRadius: 10,
  padding: "24px",
  backdropFilter: "blur(8px)",
  WebkitBackdropFilter: "blur(8px)",
};
const btn = {
  padding: "10px 16px", cursor: "pointer", background: "#f0c040", color: "#091820",
  border: "none", borderRadius: 6, fontSize: 13, letterSpacing: 2, fontWeight: "bold",
  fontFamily: "inherit",
};
const btnGhost = {
  ...btn, background: "transparent", color: "#7eabc8",
  border: "1px solid rgba(126,171,200,0.3)", fontWeight: "normal", letterSpacing: 1,
};
const code = {
  background: "rgba(0,0,0,0.35)", border: "1px solid rgba(126,171,200,0.18)",
  borderRadius: 6, padding: "10px 12px", fontFamily: "ui-monospace,Menlo,monospace",
  fontSize: 12, color: "#e8f4f8", overflowX: "auto", whiteSpace: "pre", margin: 0,
};

function StepDot({ active, done, n }) {
  const bg = done ? "#2a9a4a" : active ? "#f0c040" : "rgba(126,171,200,0.2)";
  const c  = done || active ? "#091820" : "#7eabc8";
  return (
    <div style={{
      width: 28, height: 28, borderRadius: "50%", background: bg, color: c,
      display: "flex", alignItems: "center", justifyContent: "center",
      fontSize: 12, fontWeight: "bold",
    }}>{done ? "✓" : n}</div>
  );
}

function Stepper({ step }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 28 }}>
      {[1,2,3,4].map((n) => (
        <div key={n} style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <StepDot n={n} active={step === n} done={step > n} />
          {n < 4 && <div style={{ width: 32, height: 1, background: "rgba(126,171,200,0.2)" }}/>}
        </div>
      ))}
    </div>
  );
}

export default function Onboard() {
  const [me, setMe] = useState(null);
  const [step, setStep] = useState(1);
  const [slug, setSlug] = useState("");
  const [source, setSource] = useState("cerbo");
  const [setup, setSetup] = useState(null);   // {command, setup_url, expires_in_min, slug, source}
  const [creds, setCreds] = useState(null);   // legacy raw-creds path (advanced)
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [advanced, setAdvanced] = useState(false);

  useEffect(() => {
    fetch("/api/onboarding/me").then(async (r) => {
      if (r.status === 401) { window.location.href = "/login?next=/onboard"; return; }
      const j = await r.json();
      setMe(j);
      if (j.slugs?.length === 1) setSlug(j.slugs[0]);
    });
  }, []);

  async function mintSetup() {
    setBusy(true); setErr("");
    try {
      const r = await fetch("/api/onboarding/setup-token", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slug, source }),
      });
      const j = await r.json();
      if (!r.ok) { setErr(j.error || "could not generate install command"); return; }
      setSetup(j); setCreds(null); setStep(4);
    } catch { setErr("network error"); }
    finally { setBusy(false); }
  }

  async function provisionRaw() {
    setBusy(true); setErr("");
    try {
      const r = await fetch("/api/onboarding/provision", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slug }),
      });
      const j = await r.json();
      if (!r.ok) { setErr(j.error || "provisioning failed"); return; }
      setCreds(j); setSetup(null); setStep(4);
    } catch { setErr("network error"); }
    finally { setBusy(false); }
  }

  if (!me) return <div style={{ minHeight: "100vh", background: "#071520" }} />;

  const slugList = me.slugs || [];
  const canPick  = slugList.length > 0 || me.is_admin;

  return (
    <>
      <Head>
        <title>Boat onboarding · Hara Marina</title>
        <meta name="viewport" content="width=device-width, initial-scale=1"/>
        <meta name="theme-color" content="#091820"/>
        <meta name="robots" content="noindex, nofollow"/>
      </Head>
      <div style={{
        minHeight: "100vh",
        background: "radial-gradient(ellipse at 30% 20%,#0d3050 0%,#071520 70%)",
        fontFamily: "'Georgia','Times New Roman',serif", color: "#e8f4f8",
        padding: "40px 20px",
      }}>
        <div style={{ maxWidth: 720, margin: "0 auto" }}>
          <div style={{ fontSize: 9, letterSpacing: 5, color: "#7eabc8", textTransform: "uppercase", marginBottom: 6 }}>
            ⚓ Hara Marina · Onboarding
          </div>
          <h1 style={{ margin: "0 0 24px", fontSize: 28, letterSpacing: 3 }}>Connect your boat</h1>

          <Stepper step={step} />

          <div style={card}>
            {step === 1 && (
              <>
                <h2 style={{ marginTop: 0, fontSize: 18, letterSpacing: 2 }}>1 · Pick the boat</h2>
                {!canPick ? (
                  <p style={{ color: "#e08080", fontSize: 13 }}>
                    No boats are registered to <b>{me.email}</b>. Ask the marina admin to add your boat first.
                  </p>
                ) : me.is_admin && slugList.length === 0 ? (
                  <>
                    <p style={{ fontSize: 13, color: "#9ec8e0" }}>Admin — type the slug for the boat you want to onboard.</p>
                    <input value={slug} onChange={(e)=>setSlug(e.target.value)}
                      placeholder="e.g. moi"
                      style={{ width: "100%", padding: "10px 12px", boxSizing: "border-box",
                        background: "rgba(255,255,255,0.06)", border: "1px solid rgba(126,171,200,0.25)",
                        color: "#e8f4f8", borderRadius: 6, fontFamily: "inherit", fontSize: 14 }}/>
                  </>
                ) : (
                  <div style={{ display: "grid", gap: 8 }}>
                    {slugList.map((s) => (
                      <label key={s} style={{
                        display: "flex", alignItems: "center", gap: 10, padding: "10px 12px",
                        border: `1px solid ${slug===s ? "#f0c040" : "rgba(126,171,200,0.25)"}`,
                        borderRadius: 6, cursor: "pointer",
                        background: slug===s ? "rgba(240,192,64,0.08)" : "transparent",
                      }}>
                        <input type="radio" name="slug" checked={slug===s} onChange={()=>setSlug(s)} />
                        <span style={{ fontSize: 14 }}>{s}</span>
                      </label>
                    ))}
                  </div>
                )}
                <div style={{ marginTop: 24, display: "flex", justifyContent: "flex-end" }}>
                  <button onClick={()=>setStep(2)} disabled={!slug} style={{ ...btn, opacity: slug ? 1 : 0.4 }}>Next →</button>
                </div>
              </>
            )}

            {step === 2 && (
              <>
                <h2 style={{ marginTop: 0, fontSize: 18, letterSpacing: 2 }}>2 · Choose your hardware</h2>
                <div style={{ display: "grid", gap: 10 }}>
                  {SOURCES.map((s) => (
                    <label key={s.id} style={{
                      display: "block", padding: "12px 14px",
                      border: `1px solid ${source===s.id ? "#f0c040" : "rgba(126,171,200,0.25)"}`,
                      borderRadius: 6, cursor: "pointer",
                      background: source===s.id ? "rgba(240,192,64,0.08)" : "transparent",
                    }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                        <input type="radio" name="src" checked={source===s.id} onChange={()=>setSource(s.id)} />
                        <span style={{ fontSize: 14, fontWeight: "bold" }}>{s.label}</span>
                      </div>
                      <div style={{ fontSize: 12, color: "#9ec8e0", marginTop: 4, marginLeft: 24 }}>{s.note}</div>
                    </label>
                  ))}
                </div>
                <div style={{ marginTop: 24, display: "flex", justifyContent: "space-between" }}>
                  <button onClick={()=>setStep(1)} style={btnGhost}>← Back</button>
                  <button onClick={()=>setStep(3)} style={btn}>Next →</button>
                </div>
              </>
            )}

            {step === 3 && (
              <>
                <h2 style={{ marginTop: 0, fontSize: 18, letterSpacing: 2 }}>3 · Generate install command</h2>
                <p style={{ fontSize: 13, color: "#9ec8e0", lineHeight: 1.6 }}>
                  We'll mint a one-time, 30-minute install link for <b>{slug}</b>. Paste it on your boat's Raspberry Pi and the
                  bridge installs itself — no copy-pasting passwords or YAML.
                </p>
                {err && <div style={{ marginTop: 12, color: "#e08080", fontSize: 12 }}>{err}</div>}
                <div style={{ marginTop: 24, display: "flex", justifyContent: "space-between" }}>
                  <button onClick={()=>setStep(2)} style={btnGhost}>← Back</button>
                  <button onClick={mintSetup} disabled={busy} style={{ ...btn, opacity: busy ? 0.5 : 1 }}>
                    {busy ? "Generating…" : "Generate install command"}
                  </button>
                </div>
                <div style={{ marginTop: 24, fontSize: 11, color: "#5a8aaa", textAlign: "center" }}>
                  <button onClick={()=>{ setAdvanced(true); provisionRaw(); }} disabled={busy}
                    style={{ background: "none", border: "none", color: "#7eabc8", cursor: "pointer",
                      textDecoration: "underline", fontSize: 11, fontFamily: "inherit" }}>
                    Advanced: just give me the raw MQTT credentials
                  </button>
                </div>
              </>
            )}

            {step === 4 && setup  && <SetupResult  setup={setup}  source={source} />}
            {step === 4 && creds  && <ResultStep   creds={creds}  source={source} />}
          </div>

          <div style={{ marginTop: 24, fontSize: 11, color: "#5a8aaa", textAlign: "center" }}>
            <Link href="/" style={{ color: "#7eabc8", textDecoration: "none" }}>← Back to marina</Link>
          </div>
        </div>
      </div>
    </>
  );
}

function SetupResult({ setup, source }) {
  const [copied, setCopied] = useState(false);
  const [left, setLeft] = useState((setup.expires_in_min || 30) * 60);
  useEffect(() => {
    const t = setInterval(() => setLeft((s) => Math.max(0, s - 1)), 1000);
    return () => clearInterval(t);
  }, []);
  function copy() {
    navigator.clipboard.writeText(setup.command).then(() => {
      setCopied(true); setTimeout(() => setCopied(false), 1500);
    });
  }
  const mm = String(Math.floor(left / 60)).padStart(2, "0");
  const ss = String(left % 60).padStart(2, "0");
  return (
    <>
      <h2 style={{ marginTop: 0, fontSize: 18, letterSpacing: 2 }}>4 · One command, then you're done</h2>
      <p style={{ fontSize: 13, color: "#9ec8e0", lineHeight: 1.6 }}>
        SSH into your boat's Raspberry Pi (or whatever Linux box runs alongside your
        {source === "cerbo" ? " Cerbo GX" : source === "ydwg" ? " Yacht Devices router" : " telemetry hardware"})
        and paste this. The installer downloads the bridge, fetches your config, and starts a systemd service.
      </p>

      <div style={{ marginTop: 16, display: "flex", alignItems: "center", gap: 12, fontSize: 11, color: "#7eabc8" }}>
        <span style={{ letterSpacing: 2, textTransform: "uppercase" }}>Boat</span>
        <span style={{ color: "#f0c040", fontWeight: "bold" }}>{setup.slug}</span>
        <span style={{ marginLeft: "auto", fontFamily: "ui-monospace,Menlo,monospace" }}>
          link expires in {mm}:{ss}
        </span>
      </div>

      <pre style={{ ...code, marginTop: 8 }}>{setup.command}</pre>
      <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
        <button onClick={copy} style={btn}>{copied ? "✓ Copied" : "Copy command"}</button>
        <a href={setup.setup_url} target="_blank" rel="noreferrer" style={{ ...btnGhost, textDecoration: "none", display: "inline-block" }}>
          Preview config
        </a>
      </div>

      <h3 style={{ marginTop: 28, fontSize: 14, letterSpacing: 2 }}>What it does</h3>
      <ol style={{ fontSize: 12, color: "#9ec8e0", lineHeight: 1.7, paddingLeft: 18 }}>
        <li>Detects CPU (arm64 / armv7 / amd64) and downloads the matching <code>marina-bridge</code> release.</li>
        <li>Securely fetches your boat config (broker URL, MQTT user, fresh password).</li>
        <li>Creates a <code>marina</code> system user and installs <code>/etc/systemd/system/marina-bridge.service</code>.</li>
        <li>Starts the service and tails the first 8 seconds of logs so you can see it connect.</li>
      </ol>

      <p style={{ fontSize: 12, color: "#9ec8e0", marginTop: 16 }}>
        After it finishes, refresh <Link href={`/${setup.slug}`} style={{ color: "#f0c040" }}>your boat page</Link>.
        First telemetry usually arrives within 30 seconds. If something goes wrong, check
        <code style={{ color: "#f0c040" }}> sudo journalctl -u marina-bridge -f</code>.
      </p>

      <p style={{ fontSize: 11, color: "#5a8aaa", marginTop: 16 }}>
        New to all this? Read the <Link href="/quickstart" style={{ color: "#7eabc8" }}>quickstart guide</Link>.
      </p>
    </>
  );
}

function ResultStep({ creds, source }) {
  const yaml = buildYaml(creds, source);
  return (
    <>
      <h2 style={{ marginTop: 0, fontSize: 18, letterSpacing: 2 }}>4 · You're connected</h2>
      <p style={{ fontSize: 13, color: "#9ec8e0", lineHeight: 1.6 }}>
        Save the password <b>now</b> — it isn't shown again. Re-running this wizard rotates it.
      </p>

      <div style={{ display: "grid", gap: 12, marginTop: 16 }}>
        <Field label="Broker host"     value={creds.broker.host} />
        <Field label="Broker port"     value={String(creds.broker.port)} />
        <Field label="Username"        value={creds.username} />
        <Field label="Password"        value={creds.password} secret />
        <Field label="Telemetry topic" value={creds.topic} />
      </div>

      <h3 style={{ marginTop: 28, fontSize: 14, letterSpacing: 2 }}>config.yaml</h3>
      <p style={{ fontSize: 12, color: "#9ec8e0" }}>Drop this on the boat alongside the bridge binary.</p>
      <pre style={code}>{yaml}</pre>
      <button onClick={() => downloadText(`marina-bridge.${creds.slug}.yaml`, yaml)} style={{ ...btnGhost, marginTop: 8 }}>
        ⬇︎ Download config
      </button>

      <h3 style={{ marginTop: 28, fontSize: 14, letterSpacing: 2 }}>Install the bridge</h3>
      <Install source={source} slug={creds.slug} />

      <h3 style={{ marginTop: 28, fontSize: 14, letterSpacing: 2 }}>Smoke test</h3>
      <p style={{ fontSize: 12, color: "#9ec8e0" }}>From any laptop with <code>mosquitto-clients</code> installed:</p>
      <pre style={code}>{`mosquitto_pub \\
  -h ${creds.broker.host} -p ${creds.broker.port} \\
  -u ${creds.username} -P '${creds.password}' \\
  -t '${creds.topic}' \\
  -m '{"battery":{"voltage":12.7,"percent":85},"shore_power":true}'`}</pre>
      <p style={{ fontSize: 12, color: "#9ec8e0", marginTop: 8 }}>
        Then refresh <Link href={`/${creds.slug}`} style={{ color:"#f0c040" }}>your boat page</Link>. If you see your data, you're done.
      </p>
    </>
  );
}

function Field({ label, value, secret }) {
  const [copied, setCopied] = useState(false);
  const [show, setShow] = useState(!secret);
  function copy() {
    navigator.clipboard.writeText(value).then(() => {
      setCopied(true); setTimeout(()=>setCopied(false), 1200);
    });
  }
  return (
    <div>
      <div style={{ fontSize: 10, letterSpacing: 2, color: "#7eabc8", textTransform: "uppercase", marginBottom: 4 }}>{label}</div>
      <div style={{ display: "flex", gap: 8 }}>
        <input readOnly value={show ? value : "•".repeat(Math.min(value.length, 24))}
          style={{ flex: 1, padding: "8px 10px",
            background: "rgba(0,0,0,0.35)", border: "1px solid rgba(126,171,200,0.18)",
            color: "#e8f4f8", borderRadius: 6, fontFamily: "ui-monospace,Menlo,monospace", fontSize: 12 }}/>
        {secret && (
          <button onClick={()=>setShow((s)=>!s)} style={{ ...btnGhost, padding: "6px 12px" }}>{show ? "Hide" : "Show"}</button>
        )}
        <button onClick={copy} style={{ ...btnGhost, padding: "6px 12px" }}>{copied ? "Copied" : "Copy"}</button>
      </div>
    </div>
  );
}

function Install({ source, slug }) {
  if (source === "custom") {
    return (
      <p style={{ fontSize: 12, color: "#9ec8e0" }}>
        You picked HTTP-only. POST telemetry directly to <code>/api/ingest/telemetry</code> using the marina ingest token (ask
        the admin). See <Link href="/docs/onboarding" style={{ color: "#f0c040" }}>onboarding docs</Link>.
      </p>
    );
  }
  return (
    <ol style={{ fontSize: 13, color: "#cfe6f5", lineHeight: 1.7, paddingLeft: 18 }}>
      <li>SSH to the boat's onboard computer (Raspberry Pi / Cerbo SSH / NUC).</li>
      <li>
        Download the latest bridge:
        <pre style={{ ...code, marginTop: 6 }}>{`curl -fsSL https://github.com/kepsic/hara-marina/releases/latest/download/marina-bridge-linux-arm64 -o marina-bridge
chmod +x marina-bridge`}</pre>
      </li>
      <li>Save the <code>config.yaml</code> from above next to the binary.</li>
      <li>
        Test it:
        <pre style={{ ...code, marginTop: 6 }}>{`./marina-bridge -config config.yaml`}</pre>
      </li>
      <li>
        Install as a service (Linux):
        <pre style={{ ...code, marginTop: 6 }}>{`sudo cp marina-bridge /usr/local/bin/
sudo cp config.yaml /etc/marina-bridge.yaml
curl -fsSL https://raw.githubusercontent.com/kepsic/hara-marina/main/infra/marina-bridge/systemd/marina-bridge.service \\
  | sudo tee /etc/systemd/system/marina-bridge.service
sudo systemctl daemon-reload && sudo systemctl enable --now marina-bridge`}</pre>
      </li>
    </ol>
  );
}

function downloadText(filename, text) {
  const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
  const url  = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function buildYaml(creds, source) {
  const useCerbo = source === "cerbo" || source === "both";
  const useYdwg  = source === "ydwg"  || source === "both";
  const lines = [
    `# marina-bridge config for ${creds.slug}`,
    `# generated ${new Date().toISOString()}`,
    "",
    `slug: "${creds.slug}"`,
    "publish_interval: 30s",
    "",
    "marina:",
    `  broker: "tcp://${creds.broker.host}:${creds.broker.port}"`,
    `  username: "${creds.username}"`,
    `  password: "${creds.password}"`,
    `  topic: "${creds.topic}"`,
    "",
    "sources:",
  ];
  if (useCerbo) {
    lines.push(
      "  cerbo:",
      "    enabled: true",
      "    # Local Cerbo GX MQTT broker (Settings → Services → MQTT on LAN unsecured)",
      "    broker: \"tcp://venus.local:1883\"",
      "    # vrm_id is shown on Cerbo dashboard → Settings → General → VRM portal ID",
      "    vrm_id: \"REPLACE_ME\"",
    );
  }
  if (useYdwg) {
    lines.push(
      "  ydwg:",
      "    enabled: true",
      "    # YDWG-02 RAW NMEA2000 over TCP (Settings → Server → RAW)",
      "    address: \"192.168.4.1:1457\"",
    );
  }
  if (!useCerbo && !useYdwg) lines.push("  # no sources selected — add manually");
  return lines.join("\n") + "\n";
}
