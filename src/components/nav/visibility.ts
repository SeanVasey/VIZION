/**
 * Single predicate for "does this route show the fixed bottom nav?".
 *
 * `BottomNav` uses it to decide whether to render, and `SafeAreaProvider` uses
 * it to decide whether to reserve nav-height clearance in the scroll region —
 * so the two can never disagree about whether the nav is present (which would
 * either trap content under the nav or reserve phantom space where there is no
 * nav, e.g. the auth gate / onboarding screens).
 */
export function showsBottomNav(pathname: string | null): boolean {
  // `usePathname` can momentarily be null during transitions; treat that as
  // "no nav" so neither the bar nor its reservation flashes in unexpectedly.
  if (!pathname) return false;
  return !(pathname.startsWith("/sign-in") || pathname.startsWith("/set-password"));
}

/**
 * Does this route show the floating "New prompt" button?
 *
 * Library and Settings only — the two authed surfaces that are not the
 * composer. /enhance is excluded because it already owns this action through
 * the composer's own Clear, and /library/[id] because the prompt-detail screen
 * carries its own actions that a floating control would compete with.
 *
 * An allowlist rather than "everything except /enhance": a new authed route
 * should have to opt in to floating chrome, not inherit it silently.
 */
export function showsNewPromptFab(pathname: string | null): boolean {
  if (!pathname) return false;
  return pathname === "/library" || pathname === "/profile";
}
