import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The scroll-smoothness contract.
 *
 * Frosted glass is expensive to MOVE: every `.glass` panel makes the
 * compositor snapshot, blur and re-composite its backdrop once per frame, and
 * a library screen holds a dozen of them. Three mechanisms keep a scroll
 * gesture inside its frame budget, and each is easy to break from a distance —
 * hence these guards.
 */
const ROOT = join(__dirname, "..", "..");
const CSS = readFileSync(join(ROOT, "src", "styles", "globals.css"), "utf8");
const LAYOUT = readFileSync(join(ROOT, "src", "app", "layout.tsx"), "utf8");

/** globals.css with comments removed — a rule must be a RULE, not prose about one. */
const RULES = CSS.replace(/\/\*[\s\S]*?\*\//g, "");

/** The declaration block of the first rule whose head matches. */
function block(headPattern: RegExp): string {
  for (const m of RULES.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (headPattern.test(m[1]!.trim())) return m[2]!;
  }
  return "";
}

describe("scroll performance", () => {
  describe("glass stands down while the page is in motion", () => {
    it("drops the backdrop blur under [data-scrolling]", () => {
      const decls = block(/^\[data-scrolling\]\s+\.glass$/);
      expect(decls, "no [data-scrolling] .glass rule").not.toBe("");
      expect(decls).toMatch(/(^|[\s;])backdrop-filter:\s*none/);
      // Safari is the platform this PWA targets first and still needs the
      // prefixed property — without it the whole optimisation is a no-op there.
      expect(decls).toMatch(/-webkit-backdrop-filter:\s*none/);
      // The grain is a tiled background image, re-sampled on the same schedule.
      expect(decls).toMatch(/background-image:\s*none/);
    });

    it("leaves the chrome bars blurred", () => {
      // --chrome is only ~0.42–0.45 opaque, so text passing under an
      // unblurred header would be plainly legible through it. The bars are two
      // elements; the cards are the ones that scale with content.
      expect(block(/\[data-scrolling\][^{]*glass-(chrome|nav)/)).toBe("");
    });

    it("only ever stands down `.glass`, never the ambient or nav layers", () => {
      const heads = [...RULES.matchAll(/([^{}]+)\{/g)]
        .map((m) => m[1]!.trim())
        .filter((h) => h.includes("[data-scrolling]"));
      expect(heads).toEqual(["[data-scrolling] .glass"]);
    });
  });

  describe("long lists stop scaling with content", () => {
    it("defines .scroll-row with content-visibility and a remembered size", () => {
      const decls = block(/^\.scroll-row$/);
      expect(decls, "no .scroll-row utility").not.toBe("");
      expect(decls).toMatch(/content-visibility:\s*auto/);
      // Without an intrinsic size the scrollbar jitters as rows are skipped
      // and restored; `auto` makes the engine remember the last real height.
      expect(decls).toMatch(/contain-intrinsic-size:\s*auto\s/);
    });

    it("is applied only to rows that already clip their own overflow", () => {
      // content-visibility implies `contain: paint`, which CLIPS outset
      // box-shadows — including a focus ring. A row that is not already
      // overflow-hidden (and therefore not already drawing its focus
      // indicator inset) would silently lose it: WCAG 2.4.7.
      let applications = 0;
      for (const [rel, cls] of classLists()) {
        if (!/(?:^|\s)scroll-row(?:\s|$)/.test(cls)) continue;
        applications++;
        expect(cls, `${rel}: scroll-row without overflow-hidden`).toMatch(
          /(?:^|\s)overflow-hidden(?:\s|$)/,
        );
      }
      // A scan that matches nothing would pass this silently.
      expect(applications, "scroll-row is applied nowhere").toBeGreaterThan(0);
    });
  });

  describe("smooth programmatic scrolling", () => {
    it("sets scroll-behavior: smooth on html", () => {
      expect(block(/^html$/)).toMatch(/scroll-behavior:\s*smooth/);
    });

    it("declares it to Next via data-scroll-behavior", () => {
      // Next temporarily forces `scroll-behavior: auto` around its own scroll
      // restoration so a route change doesn't ANIMATE its scroll-to-top. From
      // v16 it only does that when this attribute is present; without it,
      // every tab switch would glide to the top instead of arriving there.
      expect(LAYOUT).toMatch(/data-scroll-behavior="smooth"/);
    });

    it("still yields to prefers-reduced-motion", () => {
      expect(RULES).toMatch(/scroll-behavior:\s*auto\s*!important/);
    });
  });

  describe("the stacking-context invariant", () => {
    /**
     * Toggling `backdrop-filter` also toggles a stacking context and a
     * containing block for `position: fixed` descendants. `[data-scrolling]
     * .glass` is therefore only safe while no fixed-position element lives
     * inside a `.glass` subtree — otherwise it would re-anchor to the viewport
     * mid-scroll and jump. Every fixed overlay in the app is either portaled
     * to <body> or a root-level sibling; this pins that down so a new one has
     * to make the decision consciously.
     */
    const ALLOWED = new Map([
      ["components/ui/Sheet.tsx", "portaled to <body>"],
      ["components/ui/Toast.tsx", "portaled to <body>"],
      ["components/editor/KeyboardActionBar.tsx", "portaled to <body>"],
      ["components/NeuralMeshBackground.tsx", "root-level ambient layer"],
      ["components/nav/BottomNav.tsx", "root-level chrome"],
      ["components/settings/SettingsPanel.tsx", "root-level sibling in the panel"],
    ]);

    it("keeps every fixed-position element out of a .glass subtree", () => {
      const found = new Set<string>();
      for (const [rel, cls] of classLists()) {
        if (/(?:^|\s)fixed(?:\s|$)/.test(cls)) found.add(rel);
      }
      // The scan must actually reach the fixed elements we know exist,
      // otherwise "no offenders" means "the regex matched nothing".
      expect(found.has("components/nav/BottomNav.tsx")).toBe(true);
      expect(found.has("components/ui/Sheet.tsx")).toBe(true);

      expect(
        [...found].filter((rel) => !ALLOWED.has(rel)),
        "new fixed-position element(s): confirm they are not inside a .glass " +
          "panel (portal to <body> if they are), then add them to ALLOWED",
      ).toEqual([]);
    });

    it("keeps the portaled overlays portaled", () => {
      for (const [rel, why] of ALLOWED) {
        if (!why.startsWith("portaled")) continue;
        expect(readFileSync(join(ROOT, "src", rel), "utf8")).toMatch(/createPortal/);
      }
    });
  });
});

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...sourceFiles(full));
    else if (/\.tsx$/.test(entry)) out.push(full);
  }
  return out;
}

/**
 * Every class-list string literal under src/, as `[repo-relative path, list]`.
 *
 * Scans string and template literals rather than `className="…"` specifically,
 * because half this codebase composes its classes as `className={[…].join(" ")}`
 * — including the bottom nav, the single most important consumer of both rules
 * this file guards. A `className=`-anchored scan silently skipped all of them
 * and reported a clean sweep. Comments are stripped first so prose *about* a
 * fixed element is not mistaken for one.
 */
function classLists(): Array<[string, string]> {
  const base = join(ROOT, "src");
  const out: Array<[string, string]> = [];
  for (const file of sourceFiles(base)) {
    const rel = file.slice(base.length + 1).replace(/\\/g, "/");
    const src = readFileSync(file, "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/(^|[^:])\/\/[^\n]*/g, "$1");
    for (const m of src.matchAll(/"([^"\n]*)"|`([^`]*)`/g)) {
      out.push([rel, m[1] ?? m[2] ?? ""]);
    }
  }
  return out;
}
