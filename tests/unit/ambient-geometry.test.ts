import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The NEBULA+ blooms are sized in viewport units, and the unit choice is the
 * whole bug surface.
 *
 * They were originally authored in `vmax`, which resolves to the LARGER of
 * viewport width or height. On the 1280×800 landscape reference they were
 * tuned against, width IS the larger axis, so `vmax` behaved exactly like
 * `vw` and the design looked correct — on that machine. On a portrait phone
 * the same numbers silently re-anchor to the HEIGHT axis, and an 80vmax bloom
 * renders at 173% of the screen's width: an owner-reported bug where the
 * ambient glow swallowed the screen.
 *
 * Nothing in the suite could see that. These assertions are the guard: they
 * pin the unit, the per-axis clamp, and the ratio form that keeps offsets and
 * drift proportional to the (clamped) diameter. They are deliberately
 * stylesheet-grepping rather than rendered — jsdom resolves no viewport units,
 * and the failure mode being guarded is a source-level unit choice, which is
 * exactly what grep can see.
 */
const CSS = readFileSync(
  join(__dirname, "..", "..", "src", "styles", "globals.css"),
  "utf8",
);

/** Design numbers, from the locked NEBULA+ parameter table. */
const BLOOMS = [
  { id: "a", n: 70 },
  { id: "b", n: 80 },
  { id: "c", n: 46 },
  { id: "d", n: 38 },
] as const;

/** 1280/800 — the reference aspect ratio, and so the vh-ceiling multiplier. */
const REFERENCE_ASPECT = 1.6;

const stripped = CSS.replace(/\/\*[\s\S]*?\*\//g, "");

describe("NEBULA+ bloom geometry", () => {
  it("uses no vmax anywhere — it means a different axis in portrait", () => {
    // The single highest-value assertion in this file. `vmax` is not wrong in
    // general, but for anything sized against a landscape reference it is a
    // trap: it silently changes which axis it measures when the device turns.
    expect(
      stripped,
      "`vmax` is back in globals.css. It resolves to the LARGER viewport axis, " +
        "so a value tuned on a landscape reference re-anchors to HEIGHT on a " +
        "portrait phone and overflows. Use min(Nvw, Mvh) instead.",
    ).not.toMatch(/\bvmax\b/);
  });

  it.each(BLOOMS)(
    "bloom $id clamps its diameter per-axis with the reference aspect ratio",
    ({ id, n }) => {
      const rule = new RegExp(`\\.bg-nebula-bloom-${id}\\s*\\{([^}]*)\\}`).exec(stripped);
      expect(rule, `.bg-nebula-bloom-${id} rule not found`).not.toBeNull();
      const body = rule![1]!;

      const decl = /--bloom-size:\s*min\(\s*([\d.]+)vw\s*,\s*([\d.]+)vh\s*\)/.exec(body);
      expect(
        decl,
        `bloom ${id} must declare --bloom-size as min(<n>vw, <m>vh)`,
      ).not.toBeNull();

      const [vw, vh] = [Number(decl![1]), Number(decl![2])];
      // The vw branch carries the design number, so the reference renders
      // pixel-identically to the original vmax values.
      expect(vw, `bloom ${id}'s vw branch must be its design number`).toBe(n);
      // The vh ceiling guards the inverse case — a short/landscape screen,
      // where vmax already equalled vw and a bare unit swap fixes nothing.
      expect(
        vh,
        `bloom ${id}'s vh ceiling must be ${n} × ${REFERENCE_ASPECT} so both ` +
          `branches are equal at the 1280×800 reference`,
      ).toBeCloseTo(n * REFERENCE_ASPECT, 5);

      // Width and height both ride the clamp, or the bloom stops being round.
      expect(body).toMatch(/width:\s*var\(--bloom-size\)/);
      expect(body).toMatch(/height:\s*var\(--bloom-size\)/);
    },
  );

  it("expresses every bloom's drift as a ratio of its own clamped diameter", () => {
    // Bloom C is the reason this assertion exists. Its POSITION was already
    // per-axis (left: 30vw; top: 36vh) and correctly stayed that way, which
    // made it easy to believe its DRIFT was per-axis too. It was not — it was
    // vmax like the others — and converting it to bare vw/vh instead of the
    // ratio form quietly cut its vertical swing to 62.5% of the reference.
    for (const { id } of BLOOMS) {
      const frames = new RegExp(
        `@keyframes nebula-bloom-${id}\\s*\\{([\\s\\S]*?)\\n  \\}`,
      ).exec(stripped);
      expect(frames, `@keyframes nebula-bloom-${id} not found`).not.toBeNull();
      const body = frames![1]!;

      const translates = [...body.matchAll(/translate\(([^)]*)\)/g)];
      expect(
        translates.length,
        `@keyframes nebula-bloom-${id} should animate translate()`,
      ).toBeGreaterThan(0);

      for (const t of translates) {
        const args = t[1]!;
        // A bare viewport unit in a drift value is the regression: it no
        // longer tracks the clamped diameter, so the bloom drifts out of
        // proportion to itself on any non-reference aspect.
        expect(
          args,
          `@keyframes nebula-bloom-${id} drifts in a bare viewport unit ` +
            `(${args.trim()}). Drift must ride var(--bloom-size) so it stays ` +
            `proportional to the clamped diameter.`,
        ).not.toMatch(/[\d.]+v(w|h|min|max)\b/);
      }
    }
  });

  it("keeps bloom C's anchor position per-axis (it is an anchor, not a size)", () => {
    const rule = /\.bg-nebula-bloom-c\s*\{([^}]*)\}/.exec(stripped)![1]!;
    expect(rule).toMatch(/left:\s*30vw/);
    expect(rule).toMatch(/top:\s*36vh/);
  });
});
