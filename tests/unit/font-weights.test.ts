import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Vendored weights ⊆ used weights (audit VAR-06).
 *
 * Every entry in src/app/fonts/index.ts ships bytes: the preloaded families
 * emit a <link rel=preload> per weight on every route, auth pages included.
 * RedditSans-700 rode that path for months with zero consumers — no
 * font-bold, no <strong>, no font-weight: 700 anywhere in src — and two
 * JetBrains weights sat vendored-inert behind preload:false. This pins the
 * manifest to the weights the UI actually sets, so a new weight lands only
 * together with its first consumer (and vice versa: a new font-bold usage
 * fails here until its file is vendored).
 */
const ROOT = join(__dirname, "..", "..");
const FONTS = readFileSync(join(ROOT, "src", "app", "fonts", "index.ts"), "utf8");

/** All of src (tsx/ts/css), comments stripped, for weight-consumer scans. */
function srcCorpus(): string {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) walk(full);
      else if (/\.(tsx|ts|css)$/.test(entry)) {
        out.push(
          readFileSync(full, "utf8")
            .replace(/\/\*[\s\S]*?\*\//g, "")
            .replace(/(^|[^:])\/\/[^\n]*/g, "$1"),
        );
      }
    }
  };
  walk(join(ROOT, "src"));
  return out.join("\n");
}

function declaredWeights(family: string): number[] {
  const block = FONTS.match(
    new RegExp(`export const ${family} = localFont\\(\\{[\\s\\S]*?\\}\\);`),
  )?.[0];
  expect(block, `no localFont block for ${family}`).toBeTruthy();
  return [...block!.matchAll(/weight:\s*"(\d+)"/g)].map((m) => Number(m[1])).sort();
}

describe("vendored font weights match the weights the UI uses", () => {
  const corpus = srcCorpus();
  const uses = (re: RegExp) => re.test(corpus);

  it("declares exactly the weights with a consumer", () => {
    expect(declaredWeights("bebasNeue")).toEqual([400]);
    // Reddit Sans: 400 base, 500 = font-medium, 600 = font-semibold (and the
    // btn-laser font-weight: 600). 700 returns only with a real consumer.
    expect(declaredWeights("redditSans")).toEqual([400, 500, 600]);
    // Mono is output-region only and renders at its base weight.
    expect(declaredWeights("jetBrainsMono")).toEqual([400]);
  });

  it("finds the consumers the manifest relies on (the scan works)", () => {
    expect(uses(/\bfont-medium\b/)).toBe(true);
    expect(uses(/\bfont-semibold\b|font-weight:\s*600/)).toBe(true);
  });

  it("finds no orphaned bold usage (700 would need re-vendoring)", () => {
    expect(uses(/\bfont-bold\b|font-weight:\s*700|<strong[\s>]|<b[\s>]/)).toBe(false);
  });
});
