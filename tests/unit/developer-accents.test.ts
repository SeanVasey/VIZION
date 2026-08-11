import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { DEVELOPER_ORDER } from "@/lib/constants";

/**
 * The token contract for the per-developer library accents.
 *
 * These are checked as TEXT rather than through a DOM, deliberately: jsdom
 * loads no stylesheets, so a rendering assertion here would pass whatever the
 * CSS said. What can be proven at this level is that the layer stays in step
 * with the model roster and that the two constructions the design's contrast
 * figures depend on are still constructed that way.
 */
const ROOT = join(__dirname, "..", "..");
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");

const RAW_ACCENTS = read("src/styles/dev-accents.css");
const RAW_GLOBALS = read("src/styles/globals.css");

/** Comments stripped — an assertion a comment can satisfy is not a test. */
const strip = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, "");
const ACCENTS_CSS = strip(RAW_ACCENTS);
const GLOBALS = strip(RAW_GLOBALS);

const ACCENT_HEX = new Map(
  [...ACCENTS_CSS.matchAll(/--dev-([a-z]+):\s*(#[0-9a-f]{6})/g)].map(
    (m) => [m[1]!, m[2]!] as const,
  ),
);

/** How far apart an accent's RGB channels sit. 0 is a perfect grey. */
function chromaSpread(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  return Math.max(r!, g!, b!) - Math.min(r!, g!, b!);
}

/** WCAG relative luminance. */
function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  const lin = (c: number) => {
    const s = c / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r!) + 0.7152 * lin(g!) + 0.0722 * lin(b!);
}

/** 3:1 on the aurora-lit dark card / on the light card. See 0003. */
const CORRIDOR_FLOOR = 0.1995;
const CORRIDOR_CEILING = 0.2922;

/** CIELAB (D65), the space 0003's semantic-clearance floors are measured in. */
type Lab = readonly [number, number, number];

function lab(hex: string): Lab {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  const lin = (c: number) => {
    const s = c / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  const [R, G, B] = [lin(r!), lin(g!), lin(b!)];
  const X = R * 0.4124564 + G * 0.3575761 + B * 0.1804375;
  const Y = R * 0.2126729 + G * 0.7151522 + B * 0.072175;
  const Z = R * 0.0193339 + G * 0.119192 + B * 0.9503041;
  // D65 white point, with the CIE-recommended rational epsilon/kappa.
  const f = (t: number) => (t > 216 / 24389 ? Math.cbrt(t) : (841 / 108) * t + 4 / 29);
  const [fx, fy, fz] = [f(X / 0.95047), f(Y / 1.0), f(Z / 1.08883)];
  return [116 * fy! - 16, 500 * (fx! - fy!), 200 * (fy! - fz!)];
}

/** CIEDE2000. Pinned against 0011's published figure by the self-check below. */
function deltaE2000(a: Lab, b: Lab): number {
  const [L1, a1, b1] = a;
  const [L2, a2, b2] = b;
  const rad = Math.PI / 180;
  const deg = 180 / Math.PI;
  const C1 = Math.hypot(a1, b1);
  const C2 = Math.hypot(a2, b2);
  const Cb = (C1 + C2) / 2;
  const G = 0.5 * (1 - Math.sqrt(Cb ** 7 / (Cb ** 7 + 25 ** 7)));
  const ap1 = (1 + G) * a1;
  const ap2 = (1 + G) * a2;
  const Cp1 = Math.hypot(ap1, b1);
  const Cp2 = Math.hypot(ap2, b2);
  let hp1 = Math.atan2(b1, ap1) * deg;
  if (hp1 < 0) hp1 += 360;
  let hp2 = Math.atan2(b2, ap2) * deg;
  if (hp2 < 0) hp2 += 360;
  if (Cp1 === 0) hp1 = 0;
  if (Cp2 === 0) hp2 = 0;
  const dL = L2 - L1;
  const dC = Cp2 - Cp1;
  let dhp = 0;
  if (Cp1 * Cp2 !== 0) {
    dhp = hp2 - hp1;
    if (dhp > 180) dhp -= 360;
    else if (dhp < -180) dhp += 360;
  }
  const dH = 2 * Math.sqrt(Cp1 * Cp2) * Math.sin((dhp / 2) * rad);
  const Lb = (L1 + L2) / 2;
  const Cpb = (Cp1 + Cp2) / 2;
  let hpb: number;
  if (Cp1 * Cp2 === 0) hpb = hp1 + hp2;
  else {
    hpb = (hp1 + hp2) / 2;
    if (Math.abs(hp1 - hp2) > 180) hpb += hp1 + hp2 < 360 ? 180 : -180;
  }
  const T =
    1 -
    0.17 * Math.cos((hpb - 30) * rad) +
    0.24 * Math.cos(2 * hpb * rad) +
    0.32 * Math.cos((3 * hpb + 6) * rad) -
    0.2 * Math.cos((4 * hpb - 63) * rad);
  const dTh = 30 * Math.exp(-(((hpb - 275) / 25) ** 2));
  const Rc = 2 * Math.sqrt(Cpb ** 7 / (Cpb ** 7 + 25 ** 7));
  const Sl = 1 + (0.015 * (Lb - 50) ** 2) / Math.sqrt(20 + (Lb - 50) ** 2);
  const Sc = 1 + 0.045 * Cpb;
  const Sh = 1 + 0.015 * Cpb * T;
  const Rt = -Math.sin(2 * dTh * rad) * Rc;
  return Math.sqrt(
    (dL / Sl) ** 2 + (dC / Sc) ** 2 + (dH / Sh) ** 2 + Rt * (dC / Sc) * (dH / Sh),
  );
}

const distance = (x: string, y: string) => deltaE2000(lab(x), lab(y));

/**
 * The semantic tokens each accent must stay clear of, read out of tokens.css
 * rather than hardcoded — so this follows a retune instead of pinning the value
 * a retune is trying to change. `--laser` moved #b7ff3c → #dffa04 under 0013
 * with these floors verified only BY HAND, which is the gap this closes.
 *
 * EVERY declared value is read, not an indexed one. `tokens.css` writes the
 * light theme TWICE — once under `:root[data-theme="light"]` and again,
 * verbatim, inside the `@media (prefers-color-scheme: light)` copy for
 * `data-theme="system"`. That is the hazard documented at the top of
 * `dev-accents.css`, and the one 0013 had to work around for `--accent-ink`.
 * `--flare` is declared three times because of it; reading the first two left
 * the system-light value unchecked, so it could drift toward an accent and
 * system-theme users would breach the floor while this suite stayed green
 * (Codex review, PR #106).
 *
 * Deduped, so identical light/system-light values cost one test rather than
 * two, and a token that grows a new theme variant gains its own floor test with
 * no change here. Asserting the two light blocks are identical was the
 * alternative; covering every value is stronger, because theme-variant tokens
 * are legitimate — the job is to check whatever is declared, not to forbid
 * divergence.
 */
const TOKENS_CSS = strip(read("src/styles/tokens.css"));
const tokenHexes = (name: string): string[] => {
  const all = [
    ...TOKENS_CSS.matchAll(new RegExp(`--${name}:\\s*(#[0-9a-f]{6})`, "gi")),
  ].map((m) => m[1]!.toLowerCase());
  if (!all.length) throw new Error(`tokens.css: --${name} not found`);
  return [...new Set(all)];
};

/** 0003's semantic-clearance floors, as published in 0011's evidence table. */
const CLEARANCE = (
  [
    ["laser", 20],
    ["flare", 18],
    ["amber", 15],
    ["pulse", 15],
  ] as const
).flatMap(([name, floor]) =>
  tokenHexes(name).map((hex) => ({ label: `--${name} ${hex}`, hex, floor })),
);

describe("the accent layer tracks the developer roster", () => {
  it("defines an accent for every developer, and none for anything else", () => {
    const declared = [...ACCENTS_CSS.matchAll(/--dev-([a-z]+):\s*#/g)].map((m) => m[1]!);
    expect([...declared].sort()).toEqual([...DEVELOPER_ORDER].sort());
  });

  it("is imported, or every card silently loses its colour", () => {
    // A `var(--dev-x)` that resolves to nothing takes the .dev-mark fallback
    // and renders --silver — a working card with no identity, which is exactly
    // the kind of failure that ships unnoticed.
    expect(GLOBALS).toContain('@import "./dev-accents.css"');
  });

  it("leaves the LOCKED token file alone", () => {
    const tokens = read("src/styles/tokens.css");
    expect(tokens).not.toContain("--dev-");
    expect(tokens).not.toContain("--on-flare");
  });
});

describe("xAI is neutral on purpose", () => {
  it("renders xAI without a hue, because xAI publishes none", () => {
    // Grok's production CSS declares oklch(11.57% 0 none) — chroma literally
    // zero. Any hue here would be invented, and inventing one made the only
    // unsourced entry the loudest mark in the list.
    expect(chromaSpread(ACCENT_HEX.get("xai")!)).toBeLessThan(24);
  });

  it("is the ONLY neutral, so the absence reads as specific to this brand", () => {
    // A palette drifting toward grey generally would make xAI's neutrality
    // meaningless — it says something precise only while it is the exception.
    const neutrals = [...ACCENT_HEX].filter(([, hex]) => chromaSpread(hex) < 24);
    expect(neutrals.map(([dev]) => dev)).toEqual(["xai"]);
  });

  it("stays a FULL-contrast neutral, not a muted one", () => {
    // The risk with a lone grey among colours is that it reads as a state.
    // A dimmer value would look disabled rather than deliberately colourless,
    // so xAI is held to the full corridor even though 0011 lets ONE accent
    // (openai, which is chromatic and labelled) sit below it.
    const y = luminance(ACCENT_HEX.get("xai")!);
    expect(y).toBeGreaterThan(CORRIDOR_FLOOR); // 3:1 on the aurora-lit dark card
    expect(y).toBeLessThan(CORRIDOR_CEILING); //  3:1 on the light card
  });
});

describe("the luminance corridor, and its one sanctioned exception (0011)", () => {
  // 0003 derived the palette so ONE hex per developer clears 3:1 against both
  // composited card fills. 0011 grants a single exception on the lower bound —
  // the owner-directed openai maroon — justified by the mark being redundant
  // (the model name is text beside it), so WCAG 1.4.11 does not bind it.
  //
  // Before 0011 the corridor was only ever asserted for xai, which meant an
  // out-of-corridor accent could ship unnoticed. That is what this pins: the
  // exception has to stay deliberate and singular.
  const below = [...ACCENT_HEX].filter(([, hex]) => luminance(hex) < CORRIDOR_FLOOR);
  const above = [...ACCENT_HEX].filter(([, hex]) => luminance(hex) > CORRIDOR_CEILING);

  it("lets exactly one accent sit below the floor, and it is openai", () => {
    expect(below.map(([dev]) => dev)).toEqual(["openai"]);
  });

  it("keeps that exception on the DARK side only — nothing may breach the ceiling", () => {
    // Breaching the ceiling costs contrast on the LIGHT card, where the mark
    // has no dark-theme sibling to fall back on and the redundancy argument
    // was never made. No accent may do it.
    expect(above.map(([dev]) => dev)).toEqual([]);
  });

  it("holds openai to the value 0011 actually measured", () => {
    // Not a taste pin: 0011's whole justification rests on the measured 2.41:1
    // and on every dE2000 floor still passing at THIS value. Drifting the hex
    // without redoing that work would leave the ADR asserting numbers the
    // stylesheet no longer produces.
    expect(ACCENT_HEX.get("openai")).toBe("#9c595d");
  });
});

describe("semantic clearance — every accent stays distinguishable from the state colours", () => {
  /**
   * 0003 requires each developer accent to sit at least 20 ΔE2000 from
   * `--laser` (and 18 / 15 from the other state tokens), so an identity mark is
   * never mistaken for a status colour. Until now nothing asserted it: the file
   * bound luminance against the card fills and ΔE2000 BETWEEN accents, and the
   * clearance to the state tokens lived only in the ADRs. 0011's own reasoning
   * leans on it — the openai pin above says the maroon is justified by "every
   * dE2000 floor still passing at THIS value" — and 0013 retuned `--laser`
   * across a 15.6° hue shift with these floors verified by hand, because a
   * green suite could not speak to them.
   */

  it("computes ΔE2000 correctly — checked against the figure 0011 published", () => {
    // THIS is the assertion that makes the rest of the block mean anything. A
    // subtly wrong CIEDE2000 would clear every floor below and silently license
    // a future breach, so the implementation is pinned to a number that was
    // measured, reviewed and committed independently of this test.
    //
    // 0011's evidence table: --dev-openai #9c595d against --laser, which at the
    // time was #b7ff3c, measured 66.7. The historical hex is deliberate — this
    // checks the maths, not today's palette.
    expect(distance("#9c595d", "#b7ff3c")).toBeCloseTo(66.7, 1);
  });

  it("discriminates — a near-identical colour must FAIL the floor", () => {
    // A floor test that has never failed is not yet a test. A hue a hair off
    // --laser has to land far below 20, or the assertions below would pass on
    // any palette at all.
    const laser = tokenHexes("laser")[0]!;
    const nearlyLaser = `#${(parseInt(laser.slice(1), 16) + 0x020202).toString(16).padStart(6, "0")}`;
    expect(distance(laser, nearlyLaser)).toBeLessThan(20);
  });

  for (const { label, hex, floor } of CLEARANCE) {
    it(`keeps all twelve accents ≥ ${floor} ΔE2000 from ${label}`, () => {
      const breaches = [...ACCENT_HEX]
        .map(([dev, accent]) => ({ dev, measured: distance(accent, hex) }))
        .filter(({ measured }) => measured < floor)
        .map(({ dev, measured }) => `${dev} ${measured.toFixed(1)} < ${floor}`);
      expect(breaches, `clearance to ${label}`).toEqual([]);
    });
  }

  it("covers every declared value of a token, not just the first", () => {
    // The gap Codex caught: --flare is declared three times (dark, explicit
    // light, and the verbatim system-light copy), and an indexed read checked
    // two. Nothing about that was visible from a passing suite — this pins it,
    // so re-introducing an index fails here rather than silently narrowing
    // coverage.
    const declared = [...TOKENS_CSS.matchAll(/--flare:\s*(#[0-9a-f]{6})/gi)].map((m) =>
      m[1]!.toLowerCase(),
    );
    expect(
      declared.length,
      "tokens.css should still declare --flare in dark, light and system-light",
    ).toBeGreaterThanOrEqual(3);

    const covered = CLEARANCE.filter((c) => c.label.startsWith("--flare ")).map(
      (c) => c.hex,
    );
    for (const hex of declared) expect(covered).toContain(hex);
  });

  it("reports google as the tightest clearance to --laser", () => {
    // The margin worth watching. 0013 moved --laser and this is the accent that
    // came closest afterwards (37.0 at #dffa04) — still nearly double the floor,
    // but it is the one a future retune will squeeze first.
    const laser = tokenHexes("laser")[0]!;
    const ranked = [...ACCENT_HEX]
      .map(([dev, accent]) => [dev, distance(accent, laser)] as const)
      .sort((x, y) => x[1] - y[1]);
    expect(ranked[0]![0]).toBe("google");
    expect(ranked[0]![1]).toBeGreaterThan(20);
  });
});

describe("one hex per developer, in both themes", () => {
  it("declares no accent inside a light block", () => {
    // The palette's whole property is that each value clears 3:1 against BOTH
    // composited card fills, so it needs no light override. Adding one would
    // destroy the property it was derived to have.
    const lightBlocks = [
      ...ACCENTS_CSS.matchAll(/:root\[data-theme="light"\]\s*\{([^}]*)\}/g),
      ...ACCENTS_CSS.matchAll(/:root\[data-theme="system"\]\s*\{([^}]*)\}/g),
    ].map((m) => m[1]!);
    expect(lightBlocks.length).toBeGreaterThanOrEqual(2);
    for (const block of lightBlocks) {
      // Matched against the roster, not a `--dev-*` wildcard: `--dev-peak` and
      // the radii legitimately live in the light blocks, so a wildcard here
      // would fail on the tokens that are SUPPOSED to swap.
      for (const developer of DEVELOPER_ORDER) {
        expect(block).not.toContain(`--dev-${developer}:`);
      }
    }
  });

  it("swaps the two tokens that genuinely are theme-dependent, in BOTH light blocks", () => {
    // tokens.css declares the light theme twice — once for an explicit choice
    // and once for the system-preference path — so a token written into only
    // one of them leaves system-light users on dark values.
    expect(ACCENTS_CSS.match(/--dev-peak:/g)?.length).toBe(3);
    expect(ACCENTS_CSS.match(/--on-flare:/g)?.length).toBe(3);
  });
});

describe("the constructions the contrast figures rest on", () => {
  it("keeps the field's horizontal reach equal to the card's content gutter", () => {
    // An accent-coloured glyph sitting inside its own tint fails WCAG 1.4.11
    // at a tint of only ~8%. The mark is safe because the field's alpha is
    // identically zero at every x past the gutter the card already reserves —
    // `pr-12`, 48px. These two numbers are a PAIR: moving one without the
    // other silently puts the mark inside its own colour.
    expect(ACCENTS_CSS).toMatch(/--dev-rx:\s*48px/);
    expect(read("src/components/library/LibraryBrowser.tsx")).toContain("p-4 pr-12");
  });

  it("keeps the field's vertical reach proportional, not a fixed length", () => {
    // Card height varies with the preview (nullable) and with title wrapping.
    // A fixed px radius would make how much colour a card carries a function
    // of how long its preview happens to be.
    expect(ACCENTS_CSS).toMatch(/--dev-ry:\s*\d+%/);
  });

  it("keeps the overlay's radius in step with the card's", () => {
    // .dev-edge is inset 1px inside a rounded-2xl (1rem) card; if the card's
    // radius changes, a mismatched overlay shows as a bright corner sliver.
    expect(GLOBALS).toMatch(/\.dev-edge\s*\{[^}]*border-radius:\s*calc\(1rem - 1px\)/);
    expect(read("src/components/library/LibraryBrowser.tsx")).toContain(
      "block rounded-2xl p-4 pr-12",
    );
  });
});

describe("the focus ring the card had lost", () => {
  it("draws an INSET ring on the overlay, not an outset one on the card", () => {
    // The row is overflow-hidden (load-bearing: without it a swiped card runs
    // 84px past its own track), and overflow:hidden clips every outset shadow
    // a descendant draws — which is why the card had no visible keyboard focus
    // indicator at all. Only an inset ring survives the clip.
    const rule = /\.glass:focus-visible\s*~\s*\.dev-edge\s*\{([^}]*)\}/.exec(GLOBALS);
    expect(rule).not.toBeNull();
    expect(rule![1]).toMatch(/box-shadow:\s*inset\s/);
    expect(rule![1]).toContain("var(--accent-ink)");
  });

  it("gates the field on the swipe, never the ring", () => {
    // Gating `opacity` would take the focus ring with it, and a row can be
    // keyboard-focused and then swiped by the same hybrid-input user.
    const rule = /\.dev-edge\[data-swiping\]\s*\{([^}]*)\}/.exec(GLOBALS);
    expect(rule).not.toBeNull();
    expect(rule![1]).toMatch(/--dev-peak:\s*0%/);
    expect(rule![1]).not.toMatch(/opacity|display|visibility/);
  });
});
