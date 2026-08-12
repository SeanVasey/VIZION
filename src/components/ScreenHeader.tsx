import type { ReactNode } from "react";
import { PressableLink } from "@/components/ui/PressableLink";
import { Wordmark } from "@/components/Wordmark";
import { BrandMark } from "@/components/BrandMark";
import { ThemeToggle } from "@/components/ThemeToggle";

/**
 * Full-bleed glass header with the safe-area top inset baked in.  Shows the
 * wordmark on the primary screen and a plain title elsewhere.  `backHref`
 * adds a 44px chevron for sub-level screens — in installed-PWA standalone
 * mode there is no browser chrome, so sub-pages must carry their own way back.
 */
export function ScreenHeader({
  title,
  brand = false,
  backHref,
  action,
}: {
  title?: string;
  brand?: boolean;
  backHref?: string;
  action?: ReactNode;
}) {
  return (
    // data-chrome-bar: the contract ui/HoldSlider reads to know where the
    // app's fixed chrome actually is. Measured, never assumed — this bar's
    // height includes env(safe-area-inset-top), which no constant can predict
    // and no desktop engine can emulate (Codex review, PR #110).
    <header data-chrome-bar="" className="glass-chrome sticky top-0 z-40 pt-safe">
      <div className="mx-auto flex max-w-screen-sm items-center justify-between gap-3 px-4 py-3">
        {brand ? (
          // `text-2xl` on the ROW, the wordmark's own step (1.9375rem = 31px),
          // is what makes the mark's `em` below mean "a fraction of the
          // wordmark" — the svg would otherwise resolve em against the
          // inherited 16px body size, and the correction would be 40% short.
          // It changes nothing else: the h1 keeps `leading-none` and the
          // wordmark keeps its explicit `text-2xl`, so the type renders exactly
          // as before.
          <div className="flex items-center gap-2 text-2xl">
            {/* The MARK to the LEFT of the wordmark — R1.1.
                The glyph, not the plated app-icon tile. The tile served the
                composed Light appearance, whose plate is a gradient
                (#ECFF52 → #DFFA04 → #C2E000): almost none of its area is the
                accent, so it measured #C9E601–#D3EF02 beside a wordmark reading
                a flat --accent-ink and the two greens visibly disagreed. The
                bare glyph takes `currentColor`, so mark and wordmark are now
                the SAME token in both themes — they cannot drift apart.
                Sized by width like the auth hero, letting the 1024×892.8 aspect
                set the height: 32px wide ≈ 27.9px tall.

                THE −0.046em LIFT. `items-center` centres the h1's LINE BOX, and
                a line box is not the word: its centre sits at
                `baseline − (ascent − descent) / 2`, while the eye reads the word
                as the CAP BAND, centred at `baseline − capHeight / 2`. For Bebas
                Neue those disagree, so the mark hung low. Measured on the
                shipped header, both engines, ink to ink: it cleared the cap line
                by 0.99px (Chromium) / 0.38px (WebKit) while dropping 2.98px /
                3.79px below the baseline — nearly all of the overhang on one
                side. That is the "uneven parts over and under the word" this
                lift removes, taking the imbalance to 0.76px / −0.66px.
                It cannot go to zero in both: the engines pick different
                ascent/descent metrics for this face, so their individual optima
                are 0.058em and 0.035em, and 0.046em is the midpoint — each
                lands within ~0.4px of its own ideal instead of one being right
                and the other 1.5px out. In `em`, against the row's `text-2xl`,
                so it survives a change of wordmark size.
                tests/e2e/authed.spec.ts measures the balance on the real header
                and fails past ±1.25px. */}
            <BrandMark className="h-auto w-8 shrink-0 -translate-y-[0.046em] text-accent" />
            {/* The wordmark IS the screen's heading — every screen gets an h1
                so the document outline never starts at an h2. */}
            <h1 className="m-0 leading-none">
              <Wordmark className="text-2xl" />
            </h1>
          </div>
        ) : (
          <div className="flex min-w-0 items-center gap-2">
            {backHref && (
              <PressableLink
                href={backHref}
                aria-label="Back"
                className="-ml-2 flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-silver hover:text-chalk"
              >
                {/* 1.5px-stroke, rounded-join chevron (style-guide §1.4). */}
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  aria-hidden="true"
                  className="h-6 w-6"
                >
                  <path
                    d="M14.5 6L9 12l5.5 6"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </PressableLink>
            )}
            <h1 className="truncate font-display text-xl tracking-wide text-text">
              {title}
            </h1>
          </div>
        )}
        <div className="flex shrink-0 items-center gap-2">
          {action}
          <ThemeToggle />
        </div>
      </div>
    </header>
  );
}
