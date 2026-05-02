import fs from "fs";
import path from "path";
import Head from "next/head";
import Link from "next/link";

export async function getStaticProps() {
  const file = path.join(process.cwd(), "docs", "OWNER_ONBOARDING.md");
  const md = fs.readFileSync(file, "utf-8");
  return { props: { md } };
}

export default function DocsOnboarding({ md }) {
  return (
    <>
      <Head>
        <title>Onboarding · Hara Marina</title>
        <meta name="viewport" content="width=device-width, initial-scale=1"/>
        <meta name="theme-color" content="#091820"/>
      </Head>
      <div style={{
        minHeight: "100vh",
        background: "radial-gradient(ellipse at 30% 20%,#0d3050 0%,#071520 70%)",
        fontFamily: "'Georgia','Times New Roman',serif",
        color: "#e8f4f8",
        padding: "40px 20px",
      }}>
        <div style={{ maxWidth: 760, margin: "0 auto" }}>
          <div style={{ fontSize: 9, letterSpacing: 5, color: "#7eabc8", textTransform: "uppercase", marginBottom: 6 }}>
            ⚓ Hara Marina · Docs
          </div>
          <h1 style={{ margin: "0 0 8px", fontSize: 28, letterSpacing: 3 }}>Boat owner onboarding</h1>
          <div style={{ display: "flex", gap: 14, marginBottom: 28, fontSize: 12 }}>
            <Link href="/onboard" style={{ color: "#f0c040", textDecoration: "none" }}>→ Run the wizard</Link>
            <Link href="/" style={{ color: "#7eabc8", textDecoration: "none" }}>← Back to marina</Link>
            <a href="https://github.com/kepsic/hara-marina/blob/main/docs/OWNER_ONBOARDING.md"
               style={{ color: "#7eabc8", textDecoration: "none" }} target="_blank" rel="noreferrer">
              View on GitHub ↗
            </a>
          </div>
          <pre style={{
            whiteSpace: "pre-wrap",
            background: "rgba(0,0,0,0.30)",
            border: "1px solid rgba(126,171,200,0.18)",
            borderRadius: 10,
            padding: "24px",
            fontFamily: "ui-monospace,Menlo,monospace",
            fontSize: 13,
            lineHeight: 1.55,
            color: "#cfe6f5",
          }}>{md}</pre>
        </div>
      </div>
    </>
  );
}
