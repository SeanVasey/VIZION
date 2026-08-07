/**
 * `?draft=` prefill — the seam that lets an outside launcher hand VIZION a
 * prompt.
 *
 * The point of this is Siri Shortcuts. iOS has no Web Share Target (that API
 * is Chromium-only, and the repo's audit rules it out on those grounds), so a
 * URL parameter is the one intake path that actually works from the iOS share
 * sheet, a Shortcut, a bookmarklet, or a link in a note.
 *
 * The rules below exist because a URL is untrusted input arriving into a field
 * that may already hold real work.
 */

/**
 * Longest prefill accepted. Well under the route's 20 000-char input ceiling,
 * because a URL this long is far more likely to be junk or an accident than a
 * prompt someone meant to send — and a silently truncated prompt is worse than
 * a refused one.
 */
export const MAX_DRAFT_PARAM_CHARS = 8_000;

export type DraftParamOutcome =
  /** Nothing to do — no param, or it was empty/oversized. */
  | { kind: "none" }
  /** Safe to apply directly: the editor was empty. */
  | { kind: "apply"; text: string }
  /** The editor already holds work — ASK, never overwrite. */
  | { kind: "conflict"; text: string };

/**
 * Decide what a `?draft=` value should do, given the draft already in the
 * editor. Pure, so the rule is testable without a router or a DOM.
 *
 * Never clobbers: a link opened by accident (or a Shortcut fired twice) must
 * not be able to destroy something the user typed. When there's a conflict the
 * caller offers the replacement instead of performing it.
 */
export function resolveDraftParam(
  param: string | null,
  currentDraft: string,
): DraftParamOutcome {
  if (param === null) return { kind: "none" };
  const text = param.trim();
  if (text === "") return { kind: "none" };
  if (text.length > MAX_DRAFT_PARAM_CHARS) return { kind: "none" };
  return currentDraft.trim() === ""
    ? { kind: "apply", text }
    : { kind: "conflict", text };
}
