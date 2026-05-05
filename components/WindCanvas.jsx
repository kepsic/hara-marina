import { useEffect, useRef } from "react";

/**
 * Animated wind streamlines, Windy-style.
 *
 * Particles drift downwind across the marina. Speed scales with the live wind
 * speed (m/s); particle density and brightness scale with gust strength.
 *
 * orientation="marina": rotated house style used on the sketch landing tab
 *   where N is LEFT, S is RIGHT, E is UP, W is DOWN.
 * orientation="map": true north-up map orientation where N is UP and E is RIGHT.
 */
export default function WindCanvas({ dir, speed, gust, orientation = "marina", zIndex = 1, opacity = 0.55 }) {
  const ref = useRef(null);
  const stateRef = useRef({ particles: [], lastT: 0 });

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    let raf = 0;
    let running = true;

    function resize() {
      const dpr = window.devicePixelRatio || 1;
      const r = canvas.getBoundingClientRect();
      canvas.width = Math.max(1, Math.floor(r.width * dpr));
      canvas.height = Math.max(1, Math.floor(r.height * dpr));
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);

    // ── particle pool ──────────────────────────────────────────────────────
    const TARGET = 240;
    const s = stateRef.current;
    if (s.particles.length === 0) {
      for (let i = 0; i < TARGET; i++) s.particles.push(spawn(canvas, true));
    }

    function spawn(c, randomAge = false) {
      const r = c.getBoundingClientRect();
      return {
        x: Math.random() * r.width,
        y: Math.random() * r.height,
        life: randomAge ? Math.random() * 4 : 0,
        maxLife: 3 + Math.random() * 3,
      };
    }

    function tick(t) {
      if (!running) return;
      raf = requestAnimationFrame(tick);
      const dt = Math.min(0.05, (t - s.lastT) / 1000 || 0.016);
      s.lastT = t;

      const r = canvas.getBoundingClientRect();
      const hasWind = typeof dir === "number" && typeof speed === "number" && speed > 0;
      // downwind bearing: where the wind is GOING (= dir + 180)
      const toDeg = hasWind ? (dir + 180) % 360 : 0;
      let sx = -Math.cos(toDeg * Math.PI / 180);
      let sy = -Math.sin(toDeg * Math.PI / 180);
      if (orientation === "map") {
        // Standard map screen axes: north is up, east is right.
        sx = Math.sin(toDeg * Math.PI / 180);
        sy = -Math.cos(toDeg * Math.PI / 180);
      }
      // Speed scaling: ~25 px/s per m/s of wind, capped.
      const pxPerSec = Math.min(220, (speed || 0) * 25);
      const vx = sx * pxPerSec;
      const vy = sy * pxPerSec;

      // Fade trails — rather than clear, paint a translucent dark rect.
      ctx.fillStyle = "rgba(7, 21, 32, 0.18)";
      ctx.fillRect(0, 0, r.width, r.height);

      if (!hasWind) return;

      const gustMul = typeof gust === "number" && gust > 0
        ? Math.min(1.5, gust / Math.max(speed, 0.5))
        : 1;
      const baseAlpha = Math.min(0.55, 0.12 + speed * 0.04) * gustMul;

      ctx.lineCap = "round";
      ctx.strokeStyle = `rgba(126, 200, 240, ${baseAlpha.toFixed(3)})`;
      ctx.lineWidth = 0.9;

      for (const p of s.particles) {
        const px = p.x;
        const py = p.y;
        p.x += vx * dt;
        p.y += vy * dt;
        p.life += dt;
        // Tail length based on speed, gives the streaking effect.
        ctx.beginPath();
        ctx.moveTo(px, py);
        ctx.lineTo(p.x, p.y);
        ctx.stroke();
        // Respawn when offscreen or aged out.
        if (
          p.x < -10 || p.x > r.width + 10 ||
          p.y < -10 || p.y > r.height + 10 ||
          p.life > p.maxLife
        ) {
          // Re-spawn on the upwind edge so flow looks continuous.
          if (Math.abs(sx) > Math.abs(sy)) {
            p.x = sx > 0 ? -5 : r.width + 5;
            p.y = Math.random() * r.height;
          } else {
            p.x = Math.random() * r.width;
            p.y = sy > 0 ? -5 : r.height + 5;
          }
          p.life = 0;
          p.maxLife = 3 + Math.random() * 3;
        }
      }
    }
    raf = requestAnimationFrame(tick);

    return () => {
      running = false;
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, [dir, speed, gust, orientation]);

  return (
    <canvas
      ref={ref}
      style={{
        position: "absolute",
        inset: 0,
        width: "100%",
        height: "100%",
        pointerEvents: "none",
        opacity,
        zIndex,
      }}
      aria-hidden
    />
  );
}
