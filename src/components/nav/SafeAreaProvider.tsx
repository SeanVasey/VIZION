"use client";

import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { showsBottomNav } from "./visibility";

/**
 * Structural shell that reserves the iOS safe areas generically (the v2
 * luminance-polarity template handles the *tint*; this handles the *layout*).
 *
 * When the fixed bottom nav is present (the authed app surfaces), the scroll
 * region reserves exactly the nav's height (shared `--bottom-nav-h` var) plus
 * the home-indicator inset and a comfortable buffer, so the footer/last
 * controls always clear it. On the auth gate / onboarding screens the nav is
 * hidden, so we drop that reservation — keyed off the same `showsBottomNav`
 * predicate the nav itself uses — and let those full-height pages own their own
 * bottom inset, instead of stranding ~64px of empty space under the footer.
 */
export function SafeAreaProvider({ children }: { children: ReactNode }) {
  const reserveNav = showsBottomNav(usePathname());

  return (
    // No background here: an opaque fill would paint OVER the fixed -z-10
    // ambient layer (mesh canvas + aurora + gradient ground) and hide it —
    // html/body already carry the token background beneath that layer.
    <div className="relative flex min-h-[100dvh] flex-col text-text">
      <main
        id="main-content"
        tabIndex={-1}
        // No pt-safe here: each screen's sticky header (or full-bleed gate)
        // owns its own top inset, so adding it here would double the padding.
        className="flex-1 pl-safe pr-safe focus:outline-none"
        style={
          reserveNav
            ? {
                paddingBottom:
                  "calc(var(--bottom-nav-h) + env(safe-area-inset-bottom, 0px) + 1.5rem)",
              }
            : undefined
        }
      >
        {children}
      </main>
    </div>
  );
}
