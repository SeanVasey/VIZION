/**
 * Word-level transformation diff (product-spec §1.1, §4.1) — the brand's
 * signature gesture. Pure and deterministic so it is unit-tested in isolation.
 *
 * Produces a flat list of segments tagged equal / added / removed. The UI lights
 * "added" tokens in Laser on the Chalk (output) side and dims "removed" tokens on
 * the Void (input) side.
 */

export type DiffOp = "equal" | "added" | "removed";

export interface DiffSegment {
  op: DiffOp;
  text: string;
}

/** Split into tokens while keeping whitespace as its own tokens (so the diff
 *  can be re-joined losslessly). */
function tokenize(text: string): string[] {
  return text.match(/\s+|[^\s]+/g) ?? [];
}

/**
 * Longest-common-subsequence diff over word tokens. O(n·m) which is fine for the
 * prompt-sized inputs VIZ(IO)N handles. Returns segments in output order, with
 * removed tokens interleaved at their original position.
 */
export function diffWords(before: string, after: string): DiffSegment[] {
  const a = tokenize(before);
  const b = tokenize(after);
  const n = a.length;
  const m = b.length;

  // LCS length table.
  const lcs: number[][] = Array.from({ length: n + 1 }, () =>
    new Array<number>(m + 1).fill(0),
  );
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      lcs[i]![j] =
        a[i] === b[j]
          ? lcs[i + 1]![j + 1]! + 1
          : Math.max(lcs[i + 1]![j]!, lcs[i]![j + 1]!);
    }
  }

  const raw: DiffSegment[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      raw.push({ op: "equal", text: a[i]! });
      i++;
      j++;
    } else if (lcs[i + 1]![j]! >= lcs[i]![j + 1]!) {
      raw.push({ op: "removed", text: a[i]! });
      i++;
    } else {
      raw.push({ op: "added", text: b[j]! });
      j++;
    }
  }
  while (i < n) raw.push({ op: "removed", text: a[i++]! });
  while (j < m) raw.push({ op: "added", text: b[j++]! });

  return mergeAdjacent(raw);
}

/** Collapse runs of the same op into single segments for compact rendering. */
function mergeAdjacent(segments: DiffSegment[]): DiffSegment[] {
  const out: DiffSegment[] = [];
  for (const seg of segments) {
    const last = out[out.length - 1];
    if (last && last.op === seg.op) last.text += seg.text;
    else out.push({ ...seg });
  }
  return out;
}

/** One reviewable change: a maximal run of non-equal segments (whitespace-only
 *  equal segments between them bridge the run). `removed`/`added` are the
 *  hunk's text on the input/output side, bridges included, for display. */
export interface ChangeHunk {
  index: number;
  removed: string;
  added: string;
}

/**
 * Hunk id per segment (null = equal text outside any hunk). A hunk is a
 * maximal run of non-equal segments; whitespace-only EQUAL segments between
 * two non-equal segments belong to the run (they sit on both sides of the
 * text, so membership only affects grouping, never reconstruction). This is
 * the single grouping rule `toHunks` and `applyDecisions` share — the two
 * must never drift or accept/reject would corrupt text.
 */
export function assignHunks(segments: DiffSegment[]): (number | null)[] {
  const ids: (number | null)[] = new Array(segments.length).fill(null);
  let nextId = 0;
  let activeId: number | null = null;
  // Indexes of whitespace-equal segments pending between non-equal segments.
  let pendingWs: number[] = [];

  segments.forEach((seg, i) => {
    if (seg.op === "equal") {
      if (seg.text.trim() === "" && activeId !== null) {
        pendingWs.push(i); // may bridge to the next non-equal segment
      } else {
        // Inky equal text closes any active hunk; pending whitespace stays plain.
        activeId = null;
        pendingWs = [];
      }
      return;
    }
    if (activeId === null) {
      activeId = nextId++;
      pendingWs = [];
    } else {
      for (const w of pendingWs) ids[w] = activeId; // the bridge joined the run
      pendingWs = [];
    }
    ids[i] = activeId;
  });
  return ids;
}

/** Group a diff into reviewable hunks (the per-change accept/reject model). */
export function toHunks(segments: DiffSegment[]): ChangeHunk[] {
  const ids = assignHunks(segments);
  const hunks: ChangeHunk[] = [];
  segments.forEach((seg, i) => {
    const id = ids[i];
    if (id === null || id === undefined) return;
    if (!hunks[id]) hunks[id] = { index: id, removed: "", added: "" };
    const h = hunks[id]!;
    if (seg.op !== "added") h.removed += seg.text; // equal bridges + removed
    if (seg.op !== "removed") h.added += seg.text; // equal bridges + added
  });
  return hunks;
}

/**
 * Rebuild output text applying per-hunk decisions: a rejected hunk keeps the
 * INPUT side (removed text), a kept hunk the OUTPUT side (added text); equal
 * text always survives. Invariants (unit-tested): no rejections ⇒ exactly the
 * `after` text; all hunks rejected ⇒ exactly the `before` text — both follow
 * from the diff's lossless reconstruction contract.
 */
export function applyDecisions(
  segments: DiffSegment[],
  rejected: ReadonlySet<number>,
): string {
  const ids = assignHunks(segments);
  let out = "";
  segments.forEach((seg, i) => {
    if (seg.op === "equal") {
      out += seg.text;
      return;
    }
    const id = ids[i];
    const isRejected = id !== null && id !== undefined && rejected.has(id);
    if (seg.op === "added" && !isRejected) out += seg.text;
    if (seg.op === "removed" && isRejected) out += seg.text;
  });
  return out;
}

/**
 * Count of changed SECTIONS — the user-meaningful readout. A run of adjacent
 * non-equal segments counts once (a replaced phrase is removed+added = ONE
 * section, where the old per-segment count said two). Whitespace-only equal
 * segments don't break a run — a replaced word-pair separated by a space still
 * reads as one section — and runs containing only whitespace don't count.
 */
export function countChangedSections(segments: DiffSegment[]): number {
  let sections = 0;
  let inRun = false;
  let runHasInk = false;
  for (const seg of segments) {
    if (seg.op === "equal") {
      if (seg.text.trim() === "") continue; // whitespace bridge, run continues
      if (inRun && runHasInk) sections++;
      inRun = false;
      runHasInk = false;
    } else {
      inRun = true;
      if (seg.text.trim() !== "") runHasInk = true;
    }
  }
  if (inRun && runHasInk) sections++;
  return sections;
}
