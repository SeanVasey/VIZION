/**
 * Incremental extraction of one string field from a streaming JSON envelope.
 *
 * The enhance contract is a JSON object whose "output" field is the improved
 * prompt (lesson-hardened; enforced via json_object modes and validated by
 * parseEnhancePayload on the full text). To stream the output token-by-token
 * WITHOUT changing that contract, this scanner watches the raw response text
 * as it arrives, finds the `"output": "` opening, and decodes the string's
 * characters — including escape sequences split across chunk boundaries —
 * until the unescaped closing quote.
 *
 * Pure and dependency-free so it is unit-testable and shared by every
 * provider through the adapter (JSON extraction lives in ONE place).
 */

interface EnvelopeScanner {
  /** Feed raw response text; returns any newly decoded field characters. */
  push(chunk: string): string;
  /** True once the field's closing quote has been seen. */
  readonly done: boolean;
}

const SIMPLE_ESCAPES: Record<string, string> = {
  '"': '"',
  "\\": "\\",
  "/": "/",
  b: "\b",
  f: "\f",
  n: "\n",
  r: "\r",
  t: "\t",
};

/** Decode a pending escape sequence (starting past the backslash).
 *  Returns null when more characters are needed (a \uXXXX split mid-chunk). */
function decodeEscape(seq: string): string | null {
  const kind = seq[0];
  if (kind === undefined) return null;
  if (kind === "u") {
    if (seq.length < 5) return null;
    const code = Number.parseInt(seq.slice(1, 5), 16);
    // Surrogate halves concatenate correctly across separate \u escapes.
    return Number.isNaN(code) ? "\\" + seq : String.fromCharCode(code);
  }
  // Unknown escapes pass through literally rather than corrupting the text.
  return SIMPLE_ESCAPES[kind] ?? "\\" + kind;
}

export function createEnvelopeScanner(field = "output"): EnvelopeScanner {
  let state: "seeking" | "in-string" | "done" = "seeking";
  let seekBuf = "";
  let esc: string | null = null; // pending escape chars (past the backslash)
  const keyRe = new RegExp(`"${field}"\\s*:\\s*"`);

  return {
    get done() {
      return state === "done";
    },
    push(chunk: string): string {
      if (state === "done" || chunk === "") return "";

      if (state === "seeking") {
        seekBuf += chunk;
        const m = keyRe.exec(seekBuf);
        if (!m) {
          // Keep just enough tail for a key split across the next boundary.
          seekBuf = seekBuf.slice(-(field.length + 16));
          return "";
        }
        chunk = seekBuf.slice(m.index + m[0].length);
        seekBuf = "";
        state = "in-string";
      }

      let out = "";
      for (let i = 0; i < chunk.length; i++) {
        const ch = chunk[i]!;
        if (esc !== null) {
          esc += ch;
          const decoded = decodeEscape(esc);
          if (decoded === null) continue; // partial \uXXXX — wait for more
          out += decoded;
          esc = null;
          continue;
        }
        if (ch === "\\") {
          esc = "";
          continue;
        }
        if (ch === '"') {
          state = "done";
          break;
        }
        out += ch;
      }
      return out;
    },
  };
}
