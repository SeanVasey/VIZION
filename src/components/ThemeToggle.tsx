"use client";

import { useUIStore } from "@/stores/ui";
import { useSetTheme } from "@/lib/profile/use-theme-preference";
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
  const setTheme = useSetTheme();

  return (
    <button
      type="button"
      onClick={() => setTheme(NEXT[theme])}
      aria-label={`Theme: ${theme}. Switch to ${NEXT[theme]}.`}
      title={`Theme: ${theme}`}
      className="glass flex h-11 w-11 items-center justify-center rounded-xl text-lg text-silver transition-[color,transform] duration-150 hover:text-accent active:scale-95"
    >
      <span aria-hidden="true">{GLYPH[theme]}</span>
    </button>
  );
}

/** Inline segmented control used on the Profile screen. */
export function ThemeSegmented() {
  const theme = useUIStore((s) => s.theme);
  const setTheme = useSetTheme();

  return (
    // A group of toggle buttons, not role="radiogroup": radios promise an
    // arrow-key roving-tabindex contract these plain tab stops don't implement;
    // aria-pressed matches the actual Tab+Enter behavior (WCAG AA).
    <div role="group" aria-label="Theme" className="glass inline-flex rounded-xl p-1">
      {THEMES.map((t) => (
        <button
          key={t}
          type="button"
          aria-pressed={theme === t}
          onClick={() => setTheme(t)}
          className={[
            "rounded-lg px-3 py-2 text-sm capitalize transition-colors",
            theme === t ? "bg-laser text-on-laser" : "text-silver hover:text-chalk",
          ].join(" ")}
        >
          {t}
        </button>
      ))}
    </div>
  );
}
