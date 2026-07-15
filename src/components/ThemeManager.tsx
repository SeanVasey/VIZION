"use client";

import { useEffect } from "react";
import { useUIStore } from "@/stores/ui";
import { registerServiceWorker } from "@/lib/pwa/register-sw";
import { resolvePolarity } from "@/lib/pwa/safe-area";
import type { Theme } from "@/lib/constants";

/** Locked surface colors per theme (tokens.css). */
const SURFACE: Record<"dark" | "light", string> = {
  dark: "#0F1012", // Void (dark)
  light: "#EEF0F4", // Void (light canvas) — matches tokens.css --void on light
};

/** Collapse `system` to a concrete dark/light using the OS preference. */
function effectiveScheme(theme: Theme): "dark" | "light" {
  if (theme === "system") {
    return typeof window !== "undefined" &&
      window.matchMedia("(prefers-color-scheme: light)").matches
      ? "light"
      : "dark";
  }
  return theme;
}

/**
 * Applies the active theme to <html data-theme>, then uses the safe-area v2
 * luminance-polarity template to set the browser/status-bar tint and the iOS
 * standalone status-bar style so the notch region resolves correctly against
 * whichever surface is behind it.  Also registers the service worker once.
 */
export function ThemeManager() {
  const theme = useUIStore((s) => s.theme);

  // Register the service worker exactly once, on mount.
  useEffect(() => {
    registerServiceWorker();
  }, []);

  useEffect(() => {
    const root = document.documentElement;
    root.dataset.theme = theme;

    const apply = () => {
      const scheme = effectiveScheme(theme);
      const surface = SURFACE[scheme];
      const { statusBarStyle } = resolvePolarity(surface);

      setMeta("theme-color", surface);
      setMeta("apple-mobile-web-app-status-bar-style", statusBarStyle);
    };

    apply();

    // Keep the tint correct if the OS flips while on `system`.
    if (theme === "system") {
      const mq = window.matchMedia("(prefers-color-scheme: light)");
      mq.addEventListener("change", apply);
      return () => mq.removeEventListener("change", apply);
    }
  }, [theme]);

  return null;
}

function setMeta(name: string, content: string) {
  let el = document.querySelector<HTMLMetaElement>(`meta[name="${name}"]`);
  if (!el) {
    el = document.createElement("meta");
    el.name = name;
    document.head.appendChild(el);
  }
  el.content = content;
}
