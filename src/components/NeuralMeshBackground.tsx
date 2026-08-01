"use client";

import { useEffect, useRef } from "react";

/**
 * Ambient digital background (remediation R4).
 *
 * A single low-density neural-mesh / particle field on a fixed full-bleed
 * <canvas> behind all content.  Void ground, Silver/accent nodes at low
 * opacity — node colors resolve from the theme tokens (--silver /
 * --accent-ink) so the mesh stays legible on the light canvas and never
 * paints raw Laser on a light surface (contrast law §6).
 *
 * Performance contract:
 *  - fully decoupled from React render (refs + rAF, zero per-frame state),
 *  - capped at ~30fps and particle count scaled to the viewport,
 *  - FULLY paused while document.hidden (debug-logs "bg:paused" /
 *    "bg:resumed" — console.debug so removeConsole strips it from
 *    production, where it was pure noise in every user's console),
 *  - FULLY paused under the reduced-effects knob (`data-reduced-effects`) — the
 *    simulation itself stops, not just the CSS-hidden canvas, so no rAF work
 *    burns into a display:none surface,
 *  - under prefers-reduced-motion it renders nothing and a static CSS gradient
 *    fallback is shown instead (no canvas, no rAF) — honoured live, not just
 *    at mount.
 */
export function NeuralMeshBackground() {
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
    const LINK_DIST = 120;
    let dpr = Math.min(window.devicePixelRatio || 1, 2);
    let w = 0;
    let h = 0;

    type Node = { x: number; y: number; vx: number; vy: number };
    let nodes: Node[] = [];

    /* --- Theme-resolved palette (re-read when [data-theme] flips) --------- */
    let silverRgb = "185, 188, 197";
    let accentRgb = "183, 255, 60";

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
      silverRgb = channelsOf(style.getPropertyValue("--silver")) ?? silverRgb;
      accentRgb = channelsOf(style.getPropertyValue("--accent-ink")) ?? accentRgb;
    }

    function laserAccent(i: number) {
      // A small share of nodes glow accent; the rest are quiet Silver.
      return i % 7 === 0;
    }

    function seed() {
      // Scale particle count to viewport area, clamped low for mobile budget.
      const count = targetCount();
      nodes = Array.from({ length: count }, () => ({
        x: Math.random() * w,
        y: Math.random() * h,
        vx: (Math.random() - 0.5) * 0.18,
        vy: (Math.random() - 0.5) * 0.18,
      }));
    }

    function targetCount() {
      return Math.max(18, Math.min(54, Math.round((w * h) / 26000)));
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
      // collapse, Android keyboard) — a full reseed makes the mesh visibly
      // "scatter" mid-interaction. Clamp survivors into the new bounds and
      // only add/remove the count delta.
      if (nodes.length === 0) {
        seed();
        return;
      }
      for (const n of nodes) {
        n.x = Math.min(Math.max(n.x, 0), w);
        n.y = Math.min(Math.max(n.y, 0), h);
      }
      const count = targetCount();
      while (nodes.length > count) nodes.pop();
      while (nodes.length < count) {
        nodes.push({
          x: Math.random() * w,
          y: Math.random() * h,
          vx: (Math.random() - 0.5) * 0.18,
          vy: (Math.random() - 0.5) * 0.18,
        });
      }
    }

    function step() {
      g.clearRect(0, 0, w, h);

      for (const n of nodes) {
        n.x += n.vx;
        n.y += n.vy;
        if (n.x < 0 || n.x > w) n.vx *= -1;
        if (n.y < 0 || n.y > h) n.vy *= -1;
      }

      // Hairline links between nearby nodes (the "mesh").
      g.lineWidth = 1;
      for (let i = 0; i < nodes.length; i++) {
        const a0 = nodes[i]!;
        for (let j = i + 1; j < nodes.length; j++) {
          const b0 = nodes[j]!;
          const dx = a0.x - b0.x;
          const dy = a0.y - b0.y;
          const d = Math.hypot(dx, dy);
          if (d < LINK_DIST) {
            const alpha = (1 - d / LINK_DIST) * 0.14;
            g.strokeStyle = `rgba(${silverRgb}, ${alpha})`;
            g.beginPath();
            g.moveTo(a0.x, a0.y);
            g.lineTo(b0.x, b0.y);
            g.stroke();
          }
        }
      }

      // Nodes — quiet Silver specks, with the occasional accent node given a
      // soft halo so the field reads as a living, glowing mesh.  The halo is a
      // second translucent fill rather than canvas `shadowBlur`, which is far
      // cheaper to redraw within the mobile frame budget.
      for (let i = 0; i < nodes.length; i++) {
        const n = nodes[i]!;
        if (laserAccent(i)) {
          g.beginPath();
          g.arc(n.x, n.y, 5, 0, Math.PI * 2);
          g.fillStyle = `rgba(${accentRgb}, 0.16)`;
          g.fill();
          g.beginPath();
          g.arc(n.x, n.y, 2, 0, Math.PI * 2);
          g.fillStyle = `rgba(${accentRgb}, 0.7)`;
          g.fill();
        } else {
          g.beginPath();
          g.arc(n.x, n.y, 1.3, 0, Math.PI * 2);
          g.fillStyle = `rgba(${silverRgb}, 0.42)`;
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
    // the canvas. The simulation has to stop too, or the rAF loop keeps running
    // the full node/link math into a display:none canvas at 30fps.
    function effectsReduced() {
      return document.documentElement.hasAttribute("data-reduced-effects");
    }

    // The single gate on the loop: animate only when motion is allowed, the tab
    // is visible, and reduced-effects is off.
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

    // Re-resolve node colors when the theme flips ([data-theme] is stamped by
    // ThemeManager; the OS scheme matters while on `system`) and reconcile the
    // loop when [data-reduced-effects] toggles — both ride one observer.
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
    sync(); // starts only if canRun(); the static gradient covers the paused state.

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
    <div aria-hidden="true" className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
      {/* Static gradient ground — always present; the canvas layers on top.
          Under reduced-motion the canvas stays empty and this is the whole bg. */}
      <div className="bg-mesh-ground absolute inset-0" />
      {/* Drifting Laser glow — the top bloom shows through the header chrome. */}
      <div className="bg-aurora bg-aurora-top" />
      <div className="bg-aurora bg-aurora-drift" />
      <canvas ref={canvasRef} className="mesh-canvas absolute inset-0 h-full w-full" />
    </div>
  );
}
