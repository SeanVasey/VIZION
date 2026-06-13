import { describe, it, expect } from "vitest";
import {
  parseHex,
  relativeLuminance,
  contrastRatio,
  resolvePolarity,
} from "@/lib/pwa/safe-area";

const VOID = "#0F1012";
const CHALK = "#F2F3F6";
const LASER = "#B7FF3C";

describe("parseHex", () => {
  it("parses 6-digit hex", () => {
    expect(parseHex(VOID)).toEqual({ r: 15, g: 16, b: 18 });
  });

  it("expands 3-digit shorthand", () => {
    expect(parseHex("#fff")).toEqual({ r: 255, g: 255, b: 255 });
  });

  it("tolerates a missing leading hash", () => {
    expect(parseHex("0F1012")).toEqual({ r: 15, g: 16, b: 18 });
  });

  it("throws on invalid input", () => {
    expect(() => parseHex("nope")).toThrow();
  });
});

describe("relativeLuminance", () => {
  it("ranks Void far below Chalk", () => {
    expect(relativeLuminance(VOID)).toBeLessThan(0.05);
    expect(relativeLuminance(CHALK)).toBeGreaterThan(0.8);
  });
});

describe("contrastRatio — guardrail math (product-spec §1.2)", () => {
  it("passes AAA for Chalk text on Void", () => {
    expect(contrastRatio(CHALK, VOID)).toBeGreaterThan(7);
  });

  it("passes AAA for Void text on a Laser fill (the button rule)", () => {
    expect(contrastRatio(VOID, LASER)).toBeGreaterThan(7);
  });

  it("FAILS for Laser text on Chalk — the prohibited combination", () => {
    // Spec records 1.09:1; assert it is well below the 3:1 AA floor.
    expect(contrastRatio(LASER, CHALK)).toBeLessThan(1.5);
  });
});

describe("resolvePolarity — luminance-polarity template", () => {
  it("resolves a dark surface to light-on-dark + translucent status bar", () => {
    const p = resolvePolarity(VOID);
    expect(p.isDark).toBe(true);
    expect(p.polarity).toBe("light-on-dark");
    expect(p.foreground).toBe("chalk");
    expect(p.statusBarStyle).toBe("black-translucent");
  });

  it("resolves a light surface to dark-on-light + default status bar", () => {
    const p = resolvePolarity(CHALK);
    expect(p.isDark).toBe(false);
    expect(p.polarity).toBe("dark-on-light");
    expect(p.foreground).toBe("void");
    expect(p.statusBarStyle).toBe("default");
  });
});
