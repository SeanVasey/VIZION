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
        // Reserve space for the ~60px nav bar (+ comfortable buffer) and the
        // home-indicator inset, so the footer/last controls never sit under it.
        style={{
          paddingBottom: "calc(80px + env(safe-area-inset-bottom, 0px))",
        }}
      >
        {children}
      </main>
    </div>
  );
}
