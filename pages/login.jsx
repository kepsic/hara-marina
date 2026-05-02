import { useState } from "react";
import Head from "next/head";
import { useRouter } from "next/router";

export default function Login() {
  const router = useRouter();
  const next = typeof router.query.next === "string" ? router.query.next : "/";
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState("idle"); // idle | sending | sent | error
  const [msg, setMsg] = useState("");

  async function submit(e) {
    e.preventDefault();
    setStatus("sending"); setMsg("");
    try {
      const r = await fetch("/api/auth/request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, next }),
      });
      const j = await r.json();
      if (r.ok) {
        setStatus("sent");
        setMsg(j.message || "Check your inbox.");
      } else {
        setStatus("error");
        setMsg(j.error || "Could not send link.");
      }
    } catch {
      setStatus("error"); setMsg("Network error.");
    }
  }

  return (
    <>
      <Head>
        <title>Sign in · Hara Marina</title>
        <meta name="viewport" content="width=device-width, initial-scale=1"/>
        <meta name="theme-color" content="#091820"/>
        <meta name="robots" content="noindex, nofollow"/>
      </Head>
      <div style={{
        minHeight:"100vh",background:"radial-gradient(ellipse at 30% 20%,#0d3050 0%,#071520 70%)",
        fontFamily:"'Georgia','Times New Roman',serif",color:"#e8f4f8",
        display:"flex",alignItems:"center",justifyContent:"center",padding:20,
      }}>
        <div style={{
          width:"100%",maxWidth:400,
          background:"linear-gradient(180deg, rgba(13,36,56,0.6), rgba(9,28,44,0.6))",
          border:"1px solid rgba(126,171,200,0.18)",borderRadius:10,padding:"28px 24px",
          backdropFilter:"blur(8px)",WebkitBackdropFilter:"blur(8px)",
        }}>
          <div style={{fontSize:9,letterSpacing:5,color:"#7eabc8",textTransform:"uppercase",marginBottom:6}}>⚓ Hara Marina</div>
          <h1 style={{margin:"0 0 18px",fontSize:24,letterSpacing:3}}>Sign in</h1>
          <p style={{fontSize:12,color:"#9ec8e0",lineHeight:1.5,marginTop:0}}>
            Enter the email registered for your boat. We'll email you a one-time link to access the boat page and live telemetry.
          </p>
          {status === "sent" ? (
            <div style={{marginTop:18,padding:"12px 14px",background:"rgba(42,154,74,0.1)",
              border:"1px solid rgba(42,154,74,0.3)",borderRadius:6,color:"#9eddb0",fontSize:12}}>
              {msg}
            </div>
          ) : (
            <form onSubmit={submit} style={{marginTop:18}}>
              <input type="email" required value={email} onChange={e=>setEmail(e.target.value)}
                placeholder="you@example.com"
                style={{
                  width:"100%",boxSizing:"border-box",padding:"10px 12px",fontSize:14,
                  background:"rgba(255,255,255,0.06)",border:"1px solid rgba(126,171,200,0.25)",
                  color:"#e8f4f8",borderRadius:6,outline:"none",fontFamily:"inherit",
                }}/>
              <button type="submit" disabled={status==="sending"}
                style={{
                  marginTop:12,width:"100%",padding:"10px",cursor:"pointer",
                  background:status==="sending"?"rgba(126,171,200,0.15)":"#f0c040",
                  color:status==="sending"?"#7eabc8":"#091820",
                  border:"none",borderRadius:6,fontSize:13,letterSpacing:2,fontWeight:"bold",
                  fontFamily:"inherit",
                }}>
                {status==="sending"?"Sending…":"Email me a sign-in link"}
              </button>
              {status==="error" && (
                <div style={{marginTop:10,fontSize:11,color:"#e08080"}}>{msg}</div>
              )}
            </form>
          )}
          <div style={{marginTop:24,fontSize:10,color:"#5a8aaa",textAlign:"center"}}>
            <a href="/" style={{color:"#7eabc8",textDecoration:"none"}}>← Back to marina</a>
          </div>
        </div>
      </div>
    </>
  );
}
