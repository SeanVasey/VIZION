"use client";

import { useUIStore } from "@/stores/ui";
import { THEMES, type Theme } from "@/lib/constants";

const NEXT: Record<Theme, Theme> = {
  dark: "light",
  light: "system",
  system: "dark",
};

const GLYPH: Record<Theme, string> = {
  dark: "◐",
  light: "◑",
  system: "◓",
};

/** Cycles dark → light → system.  Laser is retained as accent in both themes. */
export function ThemeToggle() {
  const theme = useUIStore((s) => s.theme);
  const setTheme = useUIStore((s) => s.setTheme);

  return (
    <button
      type="button"
      onClick={() => setTheme(NEXT[theme])}
      aria-label={`Theme: ${theme}. Switch to ${NEXT[theme]}.`}
      title={`Theme: ${theme}`}
      className="glass flex h-11 w-11 items-center justify-center rounded-xl text-lg text-silver transition-colors hover:text-laser"
    >
      <span aria-hidden="true">{GLYPH[theme]}</span>
    </button>
  );
}

/** Inline segmented control used on the Profile screen. */
export function ThemeSegmented() {
  const theme = useUIStore((s) => s.theme);
  const setTheme = useUIStore((s) => s.setTheme);

  return (
    <div
      role="radiogroup"
      aria-label="Theme"
      className="glass inline-flex rounded-xl p-1"
    >
      {THEMES.map((t) => (
        <button
          key={t}
          type="button"
          role="radio"
          aria-checked={theme === t}
          onClick={() => setTheme(t)}
          className={[
            "rounded-lg px-3 py-2 text-sm capitalize transition-colors",
            theme === t ? "bg-laser text-void" : "text-silver hover:text-chalk",
          ].join(" ")}
        >
          {t}
        </button>
      ))}
    </div>
  );
}
