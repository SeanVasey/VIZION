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
        className="flex-1 pl-safe pr-safe pt-safe focus:outline-none"
        // Reserve space for the 64px nav bar + the home-indicator inset.
        style={{
          paddingBottom: "calc(64px + env(safe-area-inset-bottom))",
        }}
      >
        {children}
      </main>
    </div>
  );
}
