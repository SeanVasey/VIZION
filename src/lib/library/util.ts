/** Pure helpers for the library — unit-tested in isolation. */

const MIN = 60;
const HOUR = 3600;
const DAY = 86400;

/**
 * Human relative time (2026-07 UX audit): "Now", "1 min ago", "Yesterday" —
 * never machine shorthand like "0m" (which the old floor produced for
 * 45–59 s). Pure: pass `now` in.
 */
export function relativeTime(iso: string, now: number = Date.now()): string {
  const then = new Date(iso);
  const sec = Math.max(0, Math.floor((now - then.getTime()) / 1000));
  if (sec < 45) return "Now";
  if (sec < HOUR) {
    const min = Math.max(1, Math.floor(sec / MIN));
    return `${min} min ago`;
  }
  if (sec < DAY) {
    const hr = Math.floor(sec / HOUR);
    return `${hr} hr ago`;
  }
  // Calendar yesterday (local), regardless of exact elapsed hours.
  const nowDate = new Date(now);
  const yesterday = new Date(nowDate);
  yesterday.setDate(nowDate.getDate() - 1);
  if (
    then.getFullYear() === yesterday.getFullYear() &&
    then.getMonth() === yesterday.getMonth() &&
    then.getDate() === yesterday.getDate()
  ) {
    return "Yesterday";
  }
  const day = Math.floor(sec / DAY);
  if (day < 7) return `${day} days ago`;
  return then.toLocaleDateString();
}

/** Derive a short, human title from a prompt's input text. */
export function deriveTitle(input: string, max = 60): string {
  const firstLine = input.trim().split(/\r?\n/)[0]?.trim() ?? "";
  const base = firstLine || input.trim();
  if (base === "") return "Untitled prompt";
  return base.length > max ? `${base.slice(0, max - 1).trimEnd()}…` : base;
}

/** Normalise a free-form tag string into a clean, de-duplicated list. */
export function parseTags(raw: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const part of raw.split(/[,\n]/)) {
    const tag = part.trim().replace(/^#/, "").toLowerCase();
    if (tag && !seen.has(tag)) {
      seen.add(tag);
      out.push(tag);
    }
  }
  return out;
}
