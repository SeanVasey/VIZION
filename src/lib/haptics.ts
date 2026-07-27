/**
 * Capability-detected haptic feedback.
 *
 * HONEST SCOPE: `Navigator.vibrate` is unimplemented in WebKit — `safari` and
 * `safari_ios` are both false through iOS 26.5 (MDN BCD, confirmed in
 * docs/audits/VIZION-enhancement-evaluation.md). VIZ(IO)N's primary surface is
 * the installed iOS web app, where every call here is a no-op. It fires on
 * Android/Chromium only.
 *
 * The audit's standing ruling: never simulate the missing haptic with an
 * animation. Touch feedback on iOS stays the `active:scale-95` press state.
 */

/** A short confirmation tick — copy succeeded, a run finished. */
export function tap(ms = 10): void {
  if (typeof navigator === "undefined") return;
  if (typeof navigator.vibrate !== "function") return;
  try {
    navigator.vibrate(ms);
  } catch {
    // Some engines throw when the document isn't user-activated; a missing
    // buzz is never worth breaking the action that requested it.
  }
}
