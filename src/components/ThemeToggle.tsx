"use client";

import { useUIStore } from "@/stores/ui";
import { PressableButton } from "@/components/ui/PressableButton";
import { useSetTheme } from "@/lib/profile/use-theme-preference";
import { THEMES, type Theme } from "@/lib/constants";
import { Segmented } from "@/components/ui/Segmented";
import { MoonMark, SunMark, SystemMark } from "@/components/ui/glyphs";

const NEXT: Record<Theme, Theme> = {
  dark: "light",
  light: "system",
  system: "dark",
};

/** Categorical marks for the STORED setting — sun / moon / machine — in the
 *  SVG glyph language (INV-06). The rotated half-circles these replace
 *  (◐ ◑ ◓) told the modes apart only by rotation, which read as one
 *  ambiguous icon; worse, they could not say whether a dark screen was a
 *  deliberate dark choice or the system resolving it. The mark tracks the
 *  setting, never the resolved appearance, so "system" always wears the
 *  monitor — even when the OS currently resolves it to dark. */
const GLYPH: Record<Theme, typeof SunMark> = {
  dark: MoonMark,
  light: SunMark,
  system: SystemMark,
};

/** Cycles dark → light → system.  Laser is retained as accent in both themes. */
export function ThemeToggle() {
  const theme = useUIStore((s) => s.theme);
  const setTheme = useSetTheme();
  const Mark = GLYPH[theme];

  return (
    <PressableButton
      onClick={() => setTheme(NEXT[theme])}
      aria-label={`Theme: ${theme}. Switch to ${NEXT[theme]}.`}
      title={`Theme: ${theme}`}
      className="glass flex h-11 w-11 items-center justify-center rounded-xl text-silver hover:text-accent"
    >
      <Mark className="h-5 w-5" />
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
