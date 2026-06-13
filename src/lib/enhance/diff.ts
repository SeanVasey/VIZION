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

/** Count of changed (non-equal) segments — used for a quick "N changes" readout. */
export function countChanges(segments: DiffSegment[]): number {
  return segments.filter((s) => s.op !== "equal" && s.text.trim() !== "").length;
}
