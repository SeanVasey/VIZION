/** Pure helpers for the library — unit-tested in isolation. */

/** Compact relative time (e.g. "just now", "3h", "2d"). Pure: pass `now` in. */
export function relativeTime(iso: string, now: number = Date.now()): string {
  const diff = now - new Date(iso).getTime();
  const sec = Math.max(0, Math.floor(diff / 1000));
  if (sec < 45) return "just now";
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h`;
  const day = Math.floor(hr / 24);
  if (day < 7) return `${day}d`;
  const wk = Math.floor(day / 7);
  if (wk < 5) return `${wk}w`;
  return new Date(iso).toLocaleDateString();
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

export interface PromptFilter {
  query: string;
  tag: string | null;
  model: string | null;
}

interface FilterablePrompt {
  title: string;
  tags: string[];
  target_model: string;
}

/** Apply the library search + tag + model filter (pure, client-side). */
export function filterPrompts<T extends FilterablePrompt>(
  prompts: T[],
  filter: PromptFilter,
): T[] {
  const q = filter.query.trim().toLowerCase();
  return prompts.filter((p) => {
    if (q && !p.title.toLowerCase().includes(q) && !p.tags.some((t) => t.includes(q))) {
      return false;
    }
    if (filter.tag && !p.tags.includes(filter.tag)) return false;
    if (filter.model && p.target_model !== filter.model) return false;
    return true;
  });
}
