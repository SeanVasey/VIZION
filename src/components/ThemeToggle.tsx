"use client";

import { useUIStore } from "@/stores/ui";
import { PressableButton } from "@/components/ui/PressableButton";
import { useSetTheme } from "@/lib/profile/use-theme-preference";
import { THEMES, type Theme } from "@/lib/constants";
import { Segmented } from "@/components/ui/Segmented";

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
    <PressableButton
      onClick={() => setTheme(NEXT[theme])}
      aria-label={`Theme: ${theme}. Switch to ${NEXT[theme]}.`}
      title={`Theme: ${theme}`}
      className="glass flex h-11 w-11 items-center justify-center rounded-xl text-lg text-silver hover:text-accent"
    >
      <span aria-hidden="true">{GLYPH[theme]}</span>
    </PressableButton>
  );
}

/** Inline segmented control used on the Settings screen. `onResult` surfaces
 *  the sync outcome next to the control (the settings write path). */
export function ThemeSegmented({
  onResult,
}: {
  onResult?: (res: { ok: boolean; error?: string }) => void;
} = {}) {
  const theme = useUIStore((s) => s.theme);
  const setTheme = useSetTheme(onResult);

  return (
    <Segmented
      label="Theme"
      options={THEME_OPTIONS}
      value={theme}
      onChange={setTheme}
      className="capitalize"
    />
  );
}

/** THEMES carries ids only; Segmented wants labels. Theme ids read as their
 *  own labels (dark/light/system), hence the `capitalize` above rather than a
 *  second copy of the words. */
const THEME_OPTIONS = THEMES.map((t) => ({ id: t, label: t }));
