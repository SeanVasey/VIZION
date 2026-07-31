import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The accessibility contracts that can be proven without a layout engine.
 *
 * jsdom loads no stylesheets and computes no boxes, so a rendered assertion
 * here would pass whatever the CSS said and measure nothing. What CAN be
 * proven at this level is arithmetic over the declared token values, and the
 * presence or absence of the specific class combinations whose contrast and
 * hit-test consequences are worked out below.
 *
 * Every ratio in this file was a live failure before it was a test:
 *
 *   text-amber        1.41:1 light/page      (warning text, invisible)
 *   text-pulse        1.83:1 light/glass     ("Saved ✓", invisible)
 *   REMOVED_CLASS     2.98:1 dark/glass      (struck original in every diff)
 *   footer copyright  2.58:1 light/page
 *   facet counts      2.71:1 light/glass
 *   sheet <dt>        3.33:1 light/glass
 */

const ROOT = join(__dirname, "..", "..");
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");

/** Comments stripped — an assertion a comment can satisfy is not a test. */
const strip = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, "");

const RAW_TOKENS = read("src/styles/tokens.css");
const TOKENS = strip(RAW_TOKENS);

// ---------------------------------------------------------------------------
// WCAG 2.1 relative luminance and contrast, over sRGB alpha compositing.
// ---------------------------------------------------------------------------

type RGB = [number, number, number];

function parseColor(value: string): RGB & { a?: number } {
  const hex = /^#([0-9a-f]{6})$/i.exec(value.trim());
  if (hex) {
    const h = hex[1]!;
    return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)) as RGB;
  }
  const rgba = /^rgba?\(([^)]+)\)$/i.exec(value.trim());
  if (rgba) {
    const parts = rgba[1]!.split(",").map((s) => Number(s.trim()));
    const out = parts.slice(0, 3) as RGB;
    if (parts.length === 4) (out as RGB & { a?: number }).a = parts[3];
    return out;
  }
  throw new Error(`unparseable colour: ${value}`);
}

/** Composite `fg` at alpha `a` over `bg`. */
function over(fg: RGB, a: number, bg: RGB): RGB {
  return fg.map((c, i) => c * a + bg[i]! * (1 - a)) as RGB;
}

function luminance([r, g, b]: RGB): number {
  const lin = (c: number) => {
    const s = c / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

function contrast(a: RGB, b: RGB): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((p, q) => q - p);
  return (hi! + 0.05) / (lo! + 0.05);
}

// ---------------------------------------------------------------------------
// The three declaration blocks tokens.css defines, and one-level var() resolve.
// ---------------------------------------------------------------------------

/**
 * tokens.css declares the light theme TWICE — once for an explicit choice and
 * once for the system-preference path. A token written into only one of them
 * leaves system-light users on the dark value, which for `--amber-ink` means
 * back to 1.41:1. Both are resolved here so both are covered.
 */
function blockOf(head: RegExp): string {
  for (const m of TOKENS.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (head.test(m[1]!.trim())) return m[2]!;
  }
  throw new Error(`no block matching ${head}`);
}

const DARK_BLOCK = blockOf(/^:root$/);
const LIGHT_BLOCK = blockOf(/^:root\[data-theme="light"\]$/);
const SYSTEM_BLOCK = blockOf(/^:root\[data-theme="system"\]$/);

/** Raw declared value of `name` in `block`, or undefined. */
function declared(block: string, name: string): string | undefined {
  const m = new RegExp(`--${name}:\\s*([^;]+);`).exec(block);
  return m?.[1]?.trim();
}

/**
 * A theme's resolved value for `name`: the theme's own declaration if it has
 * one, else the dark block's (that IS the cascade — the light blocks only
 * override). `var(--x)` is followed once, which is all the file uses.
 */
function resolve(block: string, name: string): string {
  const raw = declared(block, name) ?? declared(DARK_BLOCK, name);
  if (!raw) throw new Error(`no token --${name}`);
  const ref = /^var\(--([a-z0-9-]+)\)$/i.exec(raw);
  return ref ? resolve(block, ref[1]!) : raw;
}

/** The three surfaces app text actually sits on, composited over the page. */
function backdrops(block: string) {
  const page = parseColor(resolve(block, "void")) as RGB;
  const mix = (token: string): RGB => {
    const c = parseColor(resolve(block, token));
    return over(c as RGB, c.a ?? 1, page);
  };
  return { page, glass: mix("glass"), surface: mix("surface") };
}

const THEMES = [
  { name: "dark", block: DARK_BLOCK },
  { name: "light", block: LIGHT_BLOCK },
  { name: "system-light", block: SYSTEM_BLOCK },
] as const;

const AA_TEXT = 4.5;

// ---------------------------------------------------------------------------

describe("text roles clear WCAG AA on every surface, in every theme", () => {
  /** Every token used as `text-*` / `border-*`, never as a fill. */
  const TEXT_ROLES = ["chalk", "silver", "accent-ink", "flare", "amber-ink", "pulse-ink"];

  for (const { name, block } of THEMES) {
    const surfaces = backdrops(block);
    for (const role of TEXT_ROLES) {
      const ink = parseColor(resolve(block, role)) as RGB;
      for (const [surface, bg] of Object.entries(surfaces)) {
        it(`${name}: --${role} on ${surface}`, () => {
          expect(contrast(ink, bg)).toBeGreaterThanOrEqual(AA_TEXT);
        });
      }
    }
  }
});

describe("fills keep their fixed ink, so they never needed a light override", () => {
  // The reason --amber/--pulse could not simply be darkened on light: they are
  // also `bg-amber` / `bg-pulse` behind --on-laser, exactly like --laser. A
  // deep amber fill under near-black ink is the failure this split avoids.
  for (const fill of ["laser", "amber", "pulse"]) {
    it(`--on-laser on a --${fill} fill`, () => {
      const ink = parseColor(resolve(DARK_BLOCK, "on-laser")) as RGB;
      expect(
        contrast(ink, parseColor(resolve(DARK_BLOCK, fill)) as RGB),
      ).toBeGreaterThanOrEqual(AA_TEXT);
      // Constant across themes — a light override would break the guarantee.
      expect(declared(LIGHT_BLOCK, fill)).toBeUndefined();
      expect(declared(SYSTEM_BLOCK, fill)).toBeUndefined();
      expect(declared(LIGHT_BLOCK, "on-laser")).toBeUndefined();
    });
  }
});

describe("the ink split is declared in all three blocks", () => {
  it("leaves the dark theme pixel-identical", () => {
    // Not `toBe(the same hex)`: an alias is the thing that CANNOT drift. If a
    // future edit gives dark its own literal, these two stop being the same
    // colour the moment one of them is touched.
    expect(declared(DARK_BLOCK, "amber-ink")).toBe("var(--amber)");
    expect(declared(DARK_BLOCK, "pulse-ink")).toBe("var(--pulse)");
  });

  it("overrides BOTH light paths, not just the explicit one", () => {
    for (const token of ["amber-ink", "pulse-ink"]) {
      expect(TOKENS.match(new RegExp(`--${token}:`, "g"))?.length).toBe(3);
      expect(declared(LIGHT_BLOCK, token)).toMatch(/^#[0-9a-f]{6}$/i);
      expect(declared(SYSTEM_BLOCK, token)).toMatch(/^#[0-9a-f]{6}$/i);
      expect(declared(LIGHT_BLOCK, token)).toBe(declared(SYSTEM_BLOCK, token));
    }
  });
});

// ---------------------------------------------------------------------------

/** Every source file under src/, so a new call site can't slip past. */
function sources(): { path: string; text: string }[] {
  const out: { path: string; text: string }[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(join(ROOT, dir))) {
      const rel = `${dir}/${entry}`;
      if (statSync(join(ROOT, rel)).isDirectory()) walk(rel);
      else if (/\.tsx?$/.test(entry)) out.push({ path: rel, text: read(rel) });
    }
  };
  walk("src");
  return out;
}

const SOURCES = sources();

describe("nothing renders amber or pulse AS TEXT", () => {
  it("uses the -ink roles at every text call site", () => {
    // Tailwind emits `text-amber` / `text-pulse` from the fill keys and no
    // config can withdraw them, so this is the only thing stopping the 1.41:1
    // and 1.83:1 renders from coming back. `bg-amber` / `bg-pulse` are fine
    // and deliberately not matched.
    const offenders = SOURCES.filter(({ text }) =>
      /\btext-(?:amber|pulse)(?!-ink)\b/.test(text),
    ).map(({ path }) => path);
    expect(offenders).toEqual([]);
  });
});

describe("no static opacity on text that was already at the muted floor", () => {
  // --silver and --flare have almost no headroom (5.99:1 and 5.64:1 on the
  // light canvas). Any alpha on top of them fails AA, and there is no value
  // that both reads as a dim and passes — which is why these are checked as
  // "absent", not "small".

  it("REMOVED_CLASS is colour and strike only", () => {
    const m = /REMOVED_CLASS\s*=\s*"([^"]*)"/.exec(
      strip(read("src/components/diff/segments.tsx")),
    );
    expect(m).not.toBeNull();
    expect(m![1]).not.toMatch(/opacity-/);
    expect(m![1]).toContain("line-through");
  });

  it("keeps the footer's two text lines at full --silver", () => {
    const footer = strip(read("src/components/Footer.tsx"));
    for (const line of footer.split("\n")) {
      if (/text-silver/.test(line) && /opacity-/.test(line)) {
        // The brand monograms are the one exception: WCAG 1.4.11 exempts "a
        // part of a logo or brand name" from the 3:1 non-text minimum, and
        // each anchor carries its own aria-label.
        expect(line, `unexpected dimmed text: ${line.trim()}`).toContain("inline-flex");
      }
    }
  });

  it("keeps the detail sheets' <dt> keys at full --silver", () => {
    for (const p of [
      "src/components/media/MediaPreviewSheet.tsx",
      "src/components/media/AttachmentDetailsSheet.tsx",
    ]) {
      expect(strip(read(p))).not.toMatch(/<dt[^>]*opacity-/);
    }
  });

  it("dims a facet count only on the Laser fill, where the ink starts at 15.8:1", () => {
    for (const p of [
      "src/components/library/LibraryFilterSheet.tsx",
      "src/components/library/DraftsToolbar.tsx",
    ]) {
      expect(strip(read(p))).not.toMatch(/"opacity-60"/);
    }
  });
});

describe("adjacent row actions do not steal each other's taps", () => {
  it("gives the drafts edit/delete icons real padding, not .tap-44", () => {
    // .tap-44 centres a 44px pseudo on its element and bleeds past every edge;
    // its own comment says adjacent extended areas overlap and the later
    // sibling wins. On a 20px icon with an 8px gap that put Delete under the
    // right 4px of the visible pencil. Padding + an equal negative margin
    // gives a 28x44 hit box (clears WCAG 2.5.8's 24x24) with an unchanged
    // 20x20 layout footprint, so the two meet at the gap's midpoint instead.
    const rows = strip(read("src/components/library/DraftsList.tsx"))
      .split("\n")
      .filter((l) => /aria-label={`(Edit|Delete) draft/.test(l));
    expect(rows).toHaveLength(2);

    const classes = strip(read("src/components/library/DraftsList.tsx"))
      .split("\n")
      .filter((l) => /-mx-1 -my-3 shrink-0 px-1 py-3/.test(l));
    expect(classes).toHaveLength(2);
    // Scoped to a className, not the file: the comment explaining why .tap-44
    // is wrong here names it, and a test a comment can fail is a bad test.
    expect(strip(read("src/components/library/DraftsList.tsx"))).not.toMatch(
      /className="[^"]*tap-44/,
    );
  });
});

describe("live regions exist before the text they announce", () => {
  // A role="status" element inserted already carrying its message is not
  // reliably announced — a screen reader announces CHANGES inside a region it
  // is already observing. Both of these are the only feedback their surface
  // gives, so a silent one is the whole signal lost.

  it("FieldStatus never unmounts, and idle costs no layout", () => {
    const field = strip(read("src/components/settings/Field.tsx"));
    // The early `return null` is exactly the bug.
    expect(field).not.toMatch(/state === "idle"\)\s*return null/);
    expect(field).toMatch(/role="status"/);
    // sr-only, not an empty static box: every call site is in a
    // `flex flex-col gap-*`, where a permanent static child adds a gap.
    expect(field).toContain('"sr-only"');
  });

  it("the composer's cap warning is mounted whether or not it applies", () => {
    const composer = strip(read("src/components/editor/EnhanceComposer.tsx"));
    expect(composer).toMatch(/capWarning\s*\?\s*"font-body[^"]*"\s*:\s*"sr-only"/);
  });
});

describe("the crop dialog behaves like the dialog it declares itself to be", () => {
  const cropper = strip(read("src/components/avatar-crop/AvatarCropper.tsx"));

  it("traps Tab, because aria-modal already told AT the page behind is gone", () => {
    expect(cropper).toContain('aria-modal="true"');
    expect(cropper).toMatch(/e\.key !== "Tab"/);
    expect(cropper).toMatch(/preventDefault\(\)[\s\S]{0,40}last\.focus\(\)/);
  });

  it("counts the dialog root as a LEADING boundary, in both modal shapes", () => {
    // Both hold focus on their own root on open, and both roots are
    // `tabIndex={-1}` — so neither appears in `focusables`, and matching only
    // against `first` let a Shift+Tab straight after open walk out backwards.
    // Behaviour is driven for real in avatar-cropper.test.tsx / sheet.test.tsx;
    // this is the "don't drop it from the other one" guard.
    expect(cropper).toMatch(
      /activeElement === first \|\| document\.activeElement === root/,
    );
    expect(strip(read("src/components/ui/Sheet.tsx"))).toMatch(
      /activeElement === first \|\| document\.activeElement === panel/,
    );
  });

  it("hands focus back to a named trigger, not to whatever <body> was", () => {
    // The host opens this by clicking a display:none file input, so capturing
    // document.activeElement would restore focus to nothing.
    expect(cropper).toContain("returnFocusRef");
    expect(strip(read("src/components/settings/SettingsPanel.tsx"))).toMatch(
      /returnFocusRef=\{avatarButton\}/,
    );
  });

  it("pans by keyboard (2.1.1) and by a tap that never dragged (2.5.7)", () => {
    for (const key of ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"]) {
      expect(cropper).toContain(`e.key === "${key}"`);
    }
    expect(cropper).toContain("TAP_SLOP");
    expect(cropper).toMatch(/drag\.moved \|\| e\.type !== "pointerup"/);
    // Focusable, or the arrow handler can never receive a key.
    expect(cropper).toMatch(/tabIndex=\{0\}/);
  });
});
