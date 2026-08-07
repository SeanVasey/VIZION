/**
 * Capability-detected haptic feedback.
 *
 * HONEST SCOPE: `Navigator.vibrate` is unimplemented in WebKit — `safari` and
 * `safari_ios` are both false through iOS 26.5 (MDN BCD, confirmed in
 * docs/audits/VIZION-enhancement-evaluation.md). VIZION's primary surface is
 * the installed iOS web app, where every call here is a no-op. It fires on
 * Android/Chromium only.
 *
 * The audit's standing ruling: never simulate the missing haptic with an
 * animation. Touch feedback on iOS is carried by the visual press state —
 * which is now `usePressable` + `.pressable` (`[data-pressed]`), not the
 * `active:scale-95` this line used to name. `:active` was retired for touch
 * feedback app-wide: it cannot outlive pointer-up, it does not cancel when a
 * press is dragged off the control, and iOS is widely reported to ignore it
 * for touch altogether unless the document carries a touch listener — a
 * workaround whose documented cost is controls flashing active during scroll.
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
