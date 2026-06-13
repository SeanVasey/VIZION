"use client";

import { useEffect, useRef } from "react";

/**
 * Ambient digital background (remediation R4).
 *
 * A single low-density neural-mesh / particle field on a fixed full-bleed
 * <canvas> behind all content.  Void ground, Silver/Laser nodes at low opacity.
 *
 * Performance contract:
 *  - fully decoupled from React render (refs + rAF, zero per-frame state),
 *  - capped at ~30fps and particle count scaled to the viewport,
 *  - FULLY paused while document.hidden (logs "bg:paused" / "bg:resumed"),
 *  - under prefers-reduced-motion it renders nothing and a static CSS gradient
 *    fallback is shown instead (no canvas, no rAF).
 */
export function NeuralMeshBackground() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const reducedRef = useRef(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)");
    reducedRef.current = reduce.matches;
    if (reduce.matches) return; // static gradient fallback handles it.

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

    function laserAccent(i: number) {
      // A small share of nodes glow Laser; the rest are quiet Silver.
      return i % 7 === 0;
    }

    function seed() {
      // Scale particle count to viewport area, clamped low for mobile budget.
      const count = Math.max(18, Math.min(54, Math.round((w * h) / 26000)));
      nodes = Array.from({ length: count }, () => ({
        x: Math.random() * w,
        y: Math.random() * h,
        vx: (Math.random() - 0.5) * 0.18,
        vy: (Math.random() - 0.5) * 0.18,
      }));
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
      seed();
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
            g.strokeStyle = `rgba(185, 188, 197, ${alpha})`;
            g.beginPath();
            g.moveTo(a0.x, a0.y);
            g.lineTo(b0.x, b0.y);
            g.stroke();
          }
        }
      }

      // Nodes — quiet Silver specks, with the occasional Laser node given a
      // soft halo so the field reads as a living, glowing mesh.
      for (let i = 0; i < nodes.length; i++) {
        const n = nodes[i]!;
        const laser = laserAccent(i);
        g.beginPath();
        g.arc(n.x, n.y, laser ? 2 : 1.3, 0, Math.PI * 2);
        if (laser) {
          g.shadowColor = "rgba(183, 255, 60, 0.9)";
          g.shadowBlur = 8;
          g.fillStyle = "rgba(183, 255, 60, 0.7)";
        } else {
          g.shadowBlur = 0;
          g.fillStyle = "rgba(185, 188, 197, 0.42)";
        }
        g.fill();
      }
      g.shadowBlur = 0;
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

    function onVisibility() {
      if (document.hidden) {
        stop();
        console.warn("bg:paused");
      } else {
        start();
        console.warn("bg:resumed");
      }
    }

    resize();
    start();
    window.addEventListener("resize", resize, { passive: true });
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      stop();
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
      <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" />
    </div>
  );
}
