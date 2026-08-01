import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Type-role contract (remediation R2 / INV-11): JetBrains Mono is scoped to
 * the enhanced-prompt OUTPUT region only.
 *
 * Inverted model (audit INV-006): instead of a hand-picked list of "UI-only"
 * files that omissions silently exempt, EVERY component/page is scanned and
 * only the known output-region files may carry a mono class. The pattern also
 * catches the `font-mono` Tailwind utility, which the previous regex could
 * not see (its hyphen prefix defeated the boundary class).
 */
const ROOT = join(__dirname, "..", "..");

/** Files sanctioned to render JetBrains Mono — each is (or contains) an
 *  enhanced-prompt output region: result bodies, diffs, generation prompts,
 *  and the editable model-written descriptions in the details sheet. */
const MONO_OUTPUT_FILES = new Set([
  "src/components/diff/TransformationDiff.tsx",
  "src/components/diff/PartialOutput.tsx",
  "src/components/diff/CompareSheet.tsx",
  "src/components/diff/StreamingResult.tsx",
  "src/components/library/PromptDetail.tsx",
  "src/components/media/GenerateSheet.tsx",
  "src/components/media/AttachmentDetailsSheet.tsx",
]);

/** Matches `mono` or `font-mono` as a standalone class token. A quote,
 *  backtick, or whitespace must precede/follow, so `--font-mono` (CSS var
 *  references) and words like "monogram" never false-positive. */
const MONO_CLASS = /(["'`\s])(?:font-)?mono(["'`\s])/;

function walkTsx(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...walkTsx(full));
    else if (name.endsWith(".tsx")) out.push(full);
  }
  return out;
}

describe("type-role scoping (mono = output region only)", () => {
  const files = [
    ...walkTsx(join(ROOT, "src/components")),
    ...walkTsx(join(ROOT, "src/app")),
  ].map((f) => relative(ROOT, f));

  it("scans the full component/page surface", () => {
    // If the tree moves, the walk must move with it — an empty scan would
    // pass every assertion below while guarding nothing.
    expect(files.length).toBeGreaterThan(50);
  });

  it("the sanctioned output-region list contains only real files", () => {
    for (const rel of MONO_OUTPUT_FILES) {
      // A renamed output file must be renamed here too, or its replacement
      // silently joins the mono ban.
      expect(files, `${rel} is gone — update MONO_OUTPUT_FILES`).toContain(rel);
    }
  });

  for (const rel of files) {
    if (MONO_OUTPUT_FILES.has(rel)) continue;
    it(`${rel} carries no mono/font-mono class (Reddit Sans only)`, () => {
      const src = readFileSync(join(ROOT, rel), "utf8");
      const match = MONO_CLASS.exec(src);
      expect(
        match,
        match ? `found ${JSON.stringify(match[0])} — mono is output-only` : "",
      ).toBeNull();
    });
  }

  it("the prompt input editor is Reddit Sans (font-body)", () => {
    const src = readFileSync(
      join(ROOT, "src/components/editor/EnhanceComposer.tsx"),
      "utf8",
    );
    // The textarea line must declare font-body and must not be mono.
    expect(src).toMatch(/id="prompt-input"[\s\S]*?font-body/);
  });
});
