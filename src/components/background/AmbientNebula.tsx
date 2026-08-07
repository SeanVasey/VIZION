"use client";

import { useEffect, useRef } from "react";

/**
 * NEBULA+ composite ambient background (R4-REV4 — replaces the R4 neural
 * mesh).
 *
 * Three stacked fixed layers, bottom to top:
 *  1. `.bg-nebula-ground` — static theme-derived radial vignette, always
 *     present; under prefers-reduced-motion it IS the whole background.
 *  2. Four `.bg-nebula-bloom` divs — blurred colour blooms driven purely by
 *     CSS keyframes (GPU-composited, negligible; they may keep drifting
 *     while the tab is hidden — only the JS loop below must stop).
 *  3. This single 2D <canvas> particle field: three parallax tiers (far /
 *     mid / near, round-robin i % 3); the first nine particles glow accent,
 *     the rest are quiet motes. Particles pulse and wrap at ±40px margins.
 *
 * Performance contract (carried over from the mesh, unchanged):
 *  - fully decoupled from React render (refs + rAF, zero per-frame state),
 *  - capped at ~30fps via frame-delta gating; count scales to viewport area
 *    against a 1280×800 reference, floor 20 — no ceiling, because the
 *    mesh's O(n²) link pass is gone and the frame cost is linear,
 *  - FULLY paused while document.hidden (debug-logs "bg:paused" /
 *    "bg:resumed" — console.debug so removeConsole strips it from
 *    production, where it was pure noise in every user's console),
 *  - FULLY paused under the reduced-effects knob (`data-reduced-effects`) —
 *    the simulation itself stops, not just the CSS-hidden canvas,
 *  - under prefers-reduced-motion this loop never starts and the canvas +
 *    blooms are display:none (globals.css) — static ground only, live.
 *
 * Colours resolve from the theme tokens so the field stays legible on the
 * light canvas and never paints raw Laser on a light surface (contrast law
 * §6): accents ride --accent-ink (= Laser on dark, deep green on light) and
 * dark motes ride --silver. Token substitutions vs the NEBULA+ parameter
 * table, per its own derive-from-tokens clause: dark motes 185,188,197
 * (table wrote 174,180,189) and light accents 63,107,0 (table wrote
 * 63,96,8). The light mote charcoal 38,42,50 is a locked spec literal that
 * matches no token. Light multiplies all alphas ×2.2, clamped (halos ≤0.45,
 * accent cores ≤0.85, mote cores ≤0.8).
 */
export function AmbientNebula() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d", { alpha: true });
    if (!ctx) return;

    // Capture the narrowed (non-null) handles so the nested rAF helpers keep
    // them non-null across closure boundaries.
    const cnv = canvas;
    const g = ctx;

    const FRAME_MS = 1000 / 30; // hard 30fps cap on mobile.
    const WRAP = 40; // wrap margin, px — particles re-enter on the far side.
    const ACCENT_COUNT = 9;
    const LASER_RGB = "183, 255, 60";
    // Owner tune: core dots read too faint at the NEBULA+ table alphas.
    // Applied before the light-theme multiplier, so its clamps still bound.
    const CORE_BOOST = 1.2;

    // Parallax tiers, far → mid → near: [rMin, rMax, speed, brightness].
    // A particle's tier is its index mod 3, so the tiers stay interleaved
    // and index-stable across resize top-ups/trims.
    const TIERS = [
      [0.5, 0.9, 0.05, 0.55],
      [0.9, 1.5, 0.1, 0.75],
      [1.4, 2.3, 0.17, 1.0],
    ] as const;

    let dpr = Math.min(window.devicePixelRatio || 1, 2);
    let w = 0;
    let h = 0;

    type Particle = {
      x: number;
      y: number;
      r: number;
      vx: number;
      vy: number;
      phase: number;
      inc: number;
    };
    let particles: Particle[] = [];

    /* --- Theme-resolved palette (re-read when [data-theme] flips) --------- */
    let silverRgb = "185, 188, 197";
    let accentRgb = "183, 255, 60";
    let isLight = false;

    function channelsOf(cssColor: string): string | null {
      const c = cssColor.trim();
      const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(c)?.[1];
      if (hex) {
        const full =
          hex.length === 3 ? hex.replace(/./g, (ch) => ch + ch) : hex;
        const n = parseInt(full, 16);
        return `${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}`;
      }
      // Digit-match the first three channels so comma- OR space-separated
      // rgb()/rgba() (modern CSS + Tailwind v4) and bare channel lists all
      // parse — a strict comma regex would fail on `rgb(185 188 197)` and
      // silently fall back to the dark defaults on a light canvas.
      const nums = c.match(/\d+/g);
      return nums && nums.length >= 3
        ? `${nums[0]}, ${nums[1]}, ${nums[2]}`
        : null;
    }

    function resolvePalette() {
      const style = getComputedStyle(document.documentElement);
      accentRgb = channelsOf(style.getPropertyValue("--accent-ink")) ?? accentRgb;
      // tokens.css sets `color-scheme` in all three theme blocks (dark /
      // light / system-light), so the computed value resolves the effective
      // scheme through the full cascade — `data-theme="system"` included.
      const scheme = style.getPropertyValue("color-scheme").trim();
      isLight = scheme ? scheme.includes("light") : accentRgb !== LASER_RGB;
      // Motes ride --silver on dark; light uses the locked NEBULA+ charcoal
      // literal (matches no token — light --silver is a mid gray, #565b63).
      silverRgb = isLight
        ? "38, 42, 50"
        : (channelsOf(style.getPropertyValue("--silver")) ?? silverRgb);
    }

    function makeParticle(i: number): Particle {
      const [rMin, rMax, speed] = TIERS[i % 3]!;
      return {
        x: Math.random() * w,
        y: Math.random() * h,
        r: rMin + Math.random() * (rMax - rMin),
        vx: (Math.random() - 0.5) * speed * 2,
        vy: (Math.random() - 0.5) * speed * 1.4,
        phase: Math.random() * Math.PI * 2,
        inc: 0.005 + Math.random() * 0.008,
      };
    }

    function seed() {
      particles = Array.from({ length: targetCount() }, (_, i) =>
        makeParticle(i),
      );
    }

    function targetCount() {
      // Scale particle count to viewport area against the 1280×800 reference.
      return Math.max(20, Math.round((80 * w * h) / (1280 * 800)));
    }

    function resize() {
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      w = window.innerWidth;
      h = window.innerHeight;
      cnv.width = Math.floor(w * dpr);
      cnv.height = Math.floor(h * dpr);
      cnv.style.width = `${w}px`;
      cnv.style.height = `${h}px`;
      g.setTransform(dpr, 0, 0, dpr, 0, 0);

      // Keep the existing field across viewport-chrome churn (iOS URL-bar
      // collapse, Android keyboard) — a full reseed makes the field visibly
      // "scatter" mid-interaction. Clamp survivors into the new bounds and
      // only add/remove the count delta; popping/pushing at the tail keeps
      // indices stable, so tier membership (i % 3) and the accent set
      // (i < ACCENT_COUNT) survive.
      if (particles.length === 0) {
        seed();
        return;
      }
      for (const p of particles) {
        p.x = Math.min(Math.max(p.x, 0), w);
        p.y = Math.min(Math.max(p.y, 0), h);
      }
      const count = targetCount();
      while (particles.length > count) particles.pop();
      while (particles.length < count) {
        particles.push(makeParticle(particles.length));
      }
    }

    function step() {
      g.clearRect(0, 0, w, h);

      // Draw far → mid → near so near particles paint over the deep tiers.
      // Each particle is visited exactly once across the three passes, so
      // integration rides the draw pass.
      for (let tier = 0; tier < 3; tier++) {
        const brightness = TIERS[tier]![3];
        for (let i = tier; i < particles.length; i += 3) {
          const p = particles[i]!;
          p.x += p.vx;
          p.y += p.vy;
          if (p.x < -WRAP) p.x = w + WRAP;
          else if (p.x > w + WRAP) p.x = -WRAP;
          if (p.y < -WRAP) p.y = h + WRAP;
          else if (p.y > h + WRAP) p.y = -WRAP;

          p.phase += p.inc;
          const s = Math.sin(p.phase);
          const drawR = p.r * (0.9 + s * 0.15);
          const glow = 0.5 + s * 0.35;

          const accent = i < ACCENT_COUNT;
          const rgb = accent ? accentRgb : silverRgb;
          let haloA = (accent ? 0.2 : 0.13) * glow * brightness;
          let coreA =
            (accent ? 0.32 + 0.28 * glow : 0.24 + 0.2 * glow) *
            brightness *
            CORE_BOOST;
          if (isLight) {
            haloA = Math.min(haloA * 2.2, 0.45);
            coreA = Math.min(coreA * 2.2, accent ? 0.85 : 0.8);
          }

          // Soft halo — a translucent radial fill rather than canvas
          // `shadowBlur`, which is far cheaper to redraw within the mobile
          // frame budget.
          const haloR = drawR * 5.6;
          const halo = g.createRadialGradient(p.x, p.y, 0, p.x, p.y, haloR);
          halo.addColorStop(0, `rgba(${rgb}, ${haloA})`);
          halo.addColorStop(1, `rgba(${rgb}, 0)`);
          g.fillStyle = halo;
          g.beginPath();
          g.arc(p.x, p.y, haloR, 0, Math.PI * 2);
          g.fill();

          g.beginPath();
          g.arc(p.x, p.y, drawR, 0, Math.PI * 2);
          g.fillStyle = `rgba(${rgb}, ${coreA})`;
          g.fill();
        }
      }
    }

    let raf = 0;
    let last = 0;
    let running = false;

    function loop(now: number) {
      raf = requestAnimationFrame(loop);
      if (now - last < FRAME_MS) return;
      last = now;
      step();
    }

    function start() {
      if (running) return;
      running = true;
      last = 0;
      raf = requestAnimationFrame(loop);
    }
    function stop() {
      running = false;
      cancelAnimationFrame(raf);
    }

    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)");

    // The reduced-effects knob (Settings → Appearance) stamps
    // `data-reduced-effects` on <html> via ReducedEffectsManager and CSS-hides
    // the canvas. The simulation has to stop too, or the rAF loop keeps
    // running the full field math into a display:none canvas at 30fps.
    function effectsReduced() {
      return document.documentElement.hasAttribute("data-reduced-effects");
    }

    // The single gate on the loop: animate only when motion is allowed, the
    // tab is visible, and reduced-effects is off.
    function canRun() {
      return !reduce.matches && !document.hidden && !effectsReduced();
    }

    // Reconcile the loop with the gate. Idempotent, so any signal (reduce,
    // visibility, or the data-reduced-effects mutation) can call it.
    function sync() {
      if (canRun()) {
        if (!running) {
          resize();
          resolvePalette();
          start();
        }
      } else if (running) {
        stop();
        g.clearRect(0, 0, w, h);
      }
    }

    function onVisibility() {
      // Keep the documented pause/resume breadcrumb; the shared gate decides
      // whether work actually resumes (it won't if effects are reduced).
      if (document.hidden) {
        console.debug("bg:paused");
      } else if (canRun()) {
        console.debug("bg:resumed");
      }
      sync();
    }

    // Re-resolve field colours when the theme flips ([data-theme] is stamped
    // by ThemeManager; the OS scheme matters while on `system`) and reconcile
    // the loop when [data-reduced-effects] toggles — both ride one observer.
    const observer = new MutationObserver(() => {
      resolvePalette();
      sync();
    });
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme", "data-reduced-effects"],
    });
    const scheme = window.matchMedia("(prefers-color-scheme: dark)");
    scheme.addEventListener("change", resolvePalette);
    reduce.addEventListener("change", sync);
    window.addEventListener("resize", resize, { passive: true });
    document.addEventListener("visibilitychange", onVisibility);

    resolvePalette();
    resize();
    sync(); // starts only if canRun(); the static ground covers the paused state.

    return () => {
      stop();
      observer.disconnect();
      scheme.removeEventListener("change", resolvePalette);
      reduce.removeEventListener("change", sync);
      window.removeEventListener("resize", resize);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);

  return (
    <div aria-hidden="true" className="bg-nebula pointer-events-none fixed inset-0 -z-10 overflow-hidden">
      {/* Static vignette ground — always present; under reduced-motion the
          blooms and canvas are display:none and this is the whole bg. */}
      <div className="bg-nebula-ground absolute inset-0" />
      {/* Blurred colour blooms — CSS keyframes only, no JS. */}
      <div className="bg-nebula-bloom bg-nebula-bloom-a" />
      <div className="bg-nebula-bloom bg-nebula-bloom-b" />
      <div className="bg-nebula-bloom bg-nebula-bloom-c" />
      <div className="bg-nebula-bloom bg-nebula-bloom-d" />
      <canvas ref={canvasRef} className="nebula-canvas absolute inset-0 h-full w-full" />
    </div>
  );
}
