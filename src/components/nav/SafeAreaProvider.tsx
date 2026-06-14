import type { ReactNode } from "react";

/**
 * Structural shell that reserves the iOS safe areas generically (the v2
 * luminance-polarity template handles the *tint*; this handles the *layout*).
 * The scroll region is padded for the fixed bottom nav + home indicator so
 * content is never trapped under the chrome.
 */
export function SafeAreaProvider({ children }: { children: ReactNode }) {
  return (
    <div className="relative flex min-h-[100dvh] flex-col bg-bg text-text">
      <main
        id="main-content"
        tabIndex={-1}
        // No pt-safe here: each screen's sticky header (or full-bleed gate)
        // owns its own top inset, so adding it here would double the padding.
        className="flex-1 pl-safe pr-safe focus:outline-none"
        // Reserve exactly the fixed nav's height (shared --bottom-nav-h var) plus
        // the home-indicator inset and a comfortable buffer, so the footer/last
        // controls always clear the nav — the reserve tracks the nav by design.
        style={{
          paddingBottom:
            "calc(var(--bottom-nav-h) + env(safe-area-inset-bottom, 0px) + 1.5rem)",
        }}
      >
        {children}
      </main>
    </div>
  );
}
