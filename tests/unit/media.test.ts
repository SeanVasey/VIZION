import { describe, it, expect } from "vitest";
import {
  buildGenerationPrompt,
  budgetStatus,
  formatBytes,
  MEDIA_QUOTA_BYTES,
} from "@/lib/media/formatters";
import { quantizePalette, kindForMime } from "@/lib/media/ondevice";
import { parseMediaAttributes, parseDataUrl } from "@/lib/media/extract";
import type { MediaAttributes } from "@/lib/media/types";

const attrs: MediaAttributes = {
  subject: "a lighthouse",
  composition: "wide shot",
  lighting: "golden hour",
  style: "cinematic",
  mood: "serene",
  palette: ["#0f1012", "#b7ff3c"],
  source: "proxy",
};

describe("buildGenerationPrompt", () => {
  it("formats Midjourney with --ar/--v and folds in attributes", () => {
    const p = buildGenerationPrompt("epic scene", attrs, "midjourney");
    expect(p).toContain("epic scene");
    expect(p).toContain("a lighthouse");
    expect(p).toContain("--ar 16:9");
    expect(p).toContain("--v 6");
    expect(p).not.toContain("--iw"); // no ref url
  });

  it("never embeds a reference URL or image-weight flag", () => {
    const p = buildGenerationPrompt("x", attrs, "midjourney");
    expect(p).not.toContain("http");
    expect(p).not.toContain("--iw");
  });

  it("formats motion engines with labeled fields", () => {
    const p = buildGenerationPrompt("clip", attrs, "runway");
    expect(p.startsWith("[runway]")).toBe(true);
    expect(p).toContain("Subject: a lighthouse.");
    expect(p).toContain("Camera & motion: wide shot.");
  });

  it("formats an audio spec", () => {
    const p = buildGenerationPrompt(
      "score",
      { source: "ondevice", tempo: "120bpm", mood: "tense", durationSec: 30 },
      "audio",
    );
    expect(p).toContain("score");
    expect(p).toContain("Tempo: 120bpm.");
    expect(p).toContain("Duration: ~30s.");
  });
});

describe("budgetStatus", () => {
  it("warns at 80% and flags over at 100%", () => {
    expect(budgetStatus(0).warn).toBe(false);
    expect(budgetStatus(MEDIA_QUOTA_BYTES * 0.85).warn).toBe(true);
    expect(budgetStatus(MEDIA_QUOTA_BYTES).over).toBe(true);
  });
  it("formats bytes", () => {
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(2048)).toBe("2 KB");
    expect(formatBytes(5 * 1024 * 1024)).toBe("5.0 MB");
  });
});

describe("quantizePalette", () => {
  it("returns the dominant colors", () => {
    // 3 black pixels, 1 lime — black should rank first.
    const data = new Uint8ClampedArray([
      0, 0, 0, 255, 0, 0, 0, 255, 0, 0, 0, 255, 183, 255, 60, 255,
    ]);
    const palette = quantizePalette(data, 2);
    expect(palette[0]).toBe("#000000");
    expect(palette).toContain("#c0ff40"); // 183→192(c0), 255→ff? rounded
  });
  it("skips transparent pixels", () => {
    const data = new Uint8ClampedArray([255, 0, 0, 0, 0, 0, 255, 255]);
    expect(quantizePalette(data, 5)).toEqual(["#0000ff"]);
  });
});

describe("kindForMime", () => {
  it("maps mime prefixes to kinds", () => {
    expect(kindForMime("image/png")).toBe("image");
    expect(kindForMime("video/mp4")).toBe("video");
    expect(kindForMime("audio/mpeg")).toBe("audio");
    expect(kindForMime("application/pdf")).toBeNull();
  });
});

describe("parseMediaAttributes", () => {
  it("picks known string fields and a palette array", () => {
    const a = parseMediaAttributes('{"subject":"cat","palette":["#fff","#000"],"x":1}');
    expect(a.subject).toBe("cat");
    expect(a.palette).toEqual(["#fff", "#000"]);
  });
  it("returns empty for invalid JSON", () => {
    expect(parseMediaAttributes("nope")).toEqual({});
  });
});

describe("parseDataUrl", () => {
  it("splits a base64 data URL", () => {
    expect(parseDataUrl("data:image/jpeg;base64,AAAA")).toEqual({
      mediaType: "image/jpeg",
      base64: "AAAA",
    });
  });
  it("returns null for non-data URLs", () => {
    expect(parseDataUrl("https://x/y.png")).toBeNull();
  });
});
