import { useEffect, useRef, useState } from "react";
import { upload } from "@vercel/blob/client";

export default function BoatPhotos({ slug, color = "#7eabc8", heroUrl = null, onSetHero = null }) {
  const [photos, setPhotos] = useState([]);
  const [loading, setLoading] = useState(true);
  const [forbidden, setForbidden] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");
  const [progress, setProgress] = useState(0);
  const [lightbox, setLightbox] = useState(null);
  const inputRef = useRef(null);

  async function load() {
    try {
      const r = await fetch(`/api/photos/${slug}`, { credentials: "same-origin" });
      if (r.status === 403) { setForbidden(true); setPhotos([]); return; }
      if (!r.ok) return;
      const j = await r.json();
      setPhotos(Array.isArray(j.photos) ? j.photos : []);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [slug]);

  async function handleFiles(fileList) {
    const files = Array.from(fileList || []).filter((f) => f.type.startsWith("image/"));
    if (!files.length) return;
    setError("");
    setUploading(true);
    setProgress(0);
    try {
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        const safe = file.name.replace(/[^a-zA-Z0-9._-]+/g, "-");
        const pathname = `boats/${slug}/${Date.now()}-${safe}`;
        const blob = await upload(pathname, file, {
          access: "public",
          handleUploadUrl: `/api/photos/${slug}`,
          contentType: file.type || undefined,
          onUploadProgress: (p) => {
            const each = 100 / files.length;
            setProgress(Math.round(i * each + (p.percentage || 0) * each / 100));
          },
        });
        // Best-effort confirm — webhook also persists in prod, but this works in dev.
        try {
          await fetch(`/api/photos/${slug}`, {
            method: "POST",
            credentials: "same-origin",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              action: "register",
              url: blob.url,
              pathname: blob.pathname,
              contentType: blob.contentType || file.type || null,
            }),
          });
        } catch {}
      }
      await load();
    } catch (e) {
      setError(e?.message || "Upload failed");
    } finally {
      setUploading(false);
      setProgress(0);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  async function handleDelete(p) {
    if (!confirm("Delete this photo?")) return;
    try {
      const r = await fetch(
        `/api/photos/${slug}?url=${encodeURIComponent(p.url)}`,
        { method: "DELETE", credentials: "same-origin" }
      );
      if (r.ok) {
        setPhotos((prev) => prev.filter((x) => x.url !== p.url));
        // If the deleted photo was the hero, clear it too.
        if (onSetHero && heroUrl && heroUrl === p.url) {
          try { await onSetHero(null); } catch {}
        }
      }
    } catch {}
  }

  async function handleSetHero(p) {
    if (!onSetHero) return;
    try { await onSetHero(p.url === heroUrl ? null : p.url); } catch {}
  }

  if (forbidden) return null;

  return (
    <div>
      <div style={{
        display:"flex",alignItems:"center",justifyContent:"space-between",
        flexWrap:"wrap",gap:8,marginBottom:10,
      }}>
        <div style={{fontSize:11,color:"#7eabc8"}}>
          {loading ? "◌ loading…" : `${photos.length} photo${photos.length === 1 ? "" : "s"}`}
        </div>
        <div style={{display:"flex",alignItems:"center",gap:10}}>
          {uploading && (
            <div style={{fontSize:10,color:"#9ec8e0",letterSpacing:1}}>
              uploading… {progress}%
            </div>
          )}
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            disabled={uploading}
            style={{
              background: uploading ? "rgba(126,171,200,0.18)" : `${color}30`,
              border: `1px solid ${color}80`,
              color: "#e8f4f8",
              padding: "6px 14px",
              borderRadius: 4,
              fontSize: 11,
              letterSpacing: 1.5,
              textTransform: "uppercase",
              cursor: uploading ? "default" : "pointer",
              fontFamily: "inherit",
            }}
          >
            {uploading ? "…" : "+ Add photos"}
          </button>
          <input
            ref={inputRef}
            type="file"
            accept="image/*"
            multiple
            onChange={(e) => handleFiles(e.target.files)}
            style={{ display: "none" }}
          />
        </div>
      </div>

      {error && (
        <div style={{
          fontSize:11,color:"#e08040",marginBottom:10,
          padding:"6px 10px",border:"1px solid rgba(224,128,64,0.4)",borderRadius:4,
        }}>{error}</div>
      )}

      {photos.length === 0 && !loading ? (
        <div style={{
          fontSize:11,color:"#5a8aaa",fontStyle:"italic",
          padding:"18px 14px",border:"1px dashed rgba(126,171,200,0.18)",borderRadius:6,
          textAlign:"center",
        }}>
          No photos yet — add the first one.
        </div>
      ) : (
        <div style={{
          display:"grid",
          gridTemplateColumns:"repeat(auto-fill, minmax(140px, 1fr))",
          gap:10,
        }}>
          {photos.map((p) => {
            const isHero = !!heroUrl && heroUrl === p.url;
            return (
            <div key={p.url} style={{position:"relative",aspectRatio:"4 / 3",
              background:"rgba(13,36,56,0.6)",
              border: isHero ? `1px solid ${color}` : "1px solid rgba(126,171,200,0.18)",
              borderRadius:6,
              overflow:"hidden",
              boxShadow: isHero ? `0 0 0 1px ${color}55` : "none"}}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={p.url}
                alt=""
                onClick={() => setLightbox(p)}
                style={{
                  width:"100%",height:"100%",objectFit:"cover",
                  cursor:"zoom-in",display:"block",
                }}
              />
              {isHero && (
                <div style={{
                  position:"absolute",top:6,left:6,
                  background:"rgba(0,0,0,0.6)",color:"#e8f4f8",
                  border:`1px solid ${color}`,
                  padding:"2px 7px",borderRadius:10,fontSize:9,
                  letterSpacing:1.5,textTransform:"uppercase",
                  pointerEvents:"none",
                }}>★ Hero</div>
              )}
              {onSetHero && (
                <button
                  type="button"
                  onClick={() => handleSetHero(p)}
                  title={isHero ? "Unset hero image" : "Use as hero image"}
                  style={{
                    position:"absolute",bottom:6,left:6,
                    background: isHero ? `${color}cc` : "rgba(0,0,0,0.55)",
                    color:"#e8f4f8",
                    border:`1px solid ${isHero ? color : "rgba(255,255,255,0.18)"}`,
                    padding:"3px 8px",borderRadius:10,fontSize:10,
                    letterSpacing:1,textTransform:"uppercase",
                    cursor:"pointer",fontFamily:"inherit",lineHeight:1,
                  }}
                >{isHero ? "★ Hero" : "☆ Set hero"}</button>
              )}
              <button
                type="button"
                onClick={() => handleDelete(p)}
                title="Delete"
                style={{
                  position:"absolute",top:6,right:6,
                  background:"rgba(0,0,0,0.55)",color:"#e8f4f8",
                  border:"1px solid rgba(255,255,255,0.18)",
                  width:24,height:24,borderRadius:12,fontSize:12,
                  cursor:"pointer",lineHeight:1,padding:0,
                }}
              >×</button>
            </div>
            );
          })}
        </div>
      )}

      {lightbox && (
        <div
          onClick={() => setLightbox(null)}
          style={{
            position:"fixed",inset:0,background:"rgba(2,10,20,0.92)",
            display:"flex",alignItems:"center",justifyContent:"center",
            zIndex:1000,padding:20,cursor:"zoom-out",
          }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={lightbox.url} alt=""
            style={{maxWidth:"100%",maxHeight:"100%",objectFit:"contain",
              boxShadow:"0 12px 40px rgba(0,0,0,0.6)"}}/>
        </div>
      )}
    </div>
  );
}
