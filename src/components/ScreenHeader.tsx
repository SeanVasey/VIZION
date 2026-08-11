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
    <header className="glass-chrome sticky top-0 z-40 pt-safe">
      <div className="mx-auto flex max-w-screen-sm items-center justify-between gap-3 px-4 py-3">
        {brand ? (
          <div className="flex items-center gap-2">
            {/* The MARK to the LEFT of the wordmark — R1.1.
                The glyph, not the plated app-icon tile. The tile served the
                composed Light appearance, whose plate is a gradient
                (#ECFF52 → #DFFA04 → #C2E000): almost none of its area is the
                accent, so it measured #C9E601–#D3EF02 beside a wordmark reading
                a flat --accent-ink and the two greens visibly disagreed. The
                bare glyph takes `currentColor`, so mark and wordmark are now
                the SAME token in both themes — they cannot drift apart.
                Sized by width like the auth hero, letting the 1024×892.8 aspect
                set the height: 32px wide ≈ 27.9px tall, which puts its mass on
                the wordmark's cap height rather than towering over it. */}
            <BrandMark className="h-auto w-8 shrink-0 text-accent" />
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
