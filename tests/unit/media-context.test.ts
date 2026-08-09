import { describe, expect, it } from "vitest";
import {
  buildMediaContext,
  buildStyleSnippet,
  sanitizeName,
  MAX_CONTEXT_ITEMS,
} from "@/lib/media/context";
import type { MediaItem } from "@/lib/media/queue";

function item(
  over: Partial<MediaItem>,
): Pick<MediaItem, "role" | "status" | "name" | "description" | "attrs"> {
  return {
    role: "reference",
    status: "ready",
    name: "shot.jpg",
    description: "A red lighthouse at dusk.",
    attrs: undefined,
    ...over,
  };
}

describe("buildMediaContext", () => {
  it("includes only READY reference-role items", () => {
    const blocks = buildMediaContext([
      item({}),
      item({ role: "generate", name: "gen.jpg" }),
      item({ role: "describe", name: "desc.jpg" }),
      item({ status: "analyzing", name: "pending.jpg" }),
    ]);
    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toContain("shot.jpg");
    expect(blocks[0]).toContain("A red lighthouse at dusk.");
  });

  it("falls back to an on-device attribute summary when there is no prose", () => {
    const blocks = buildMediaContext([
      item({
        description: undefined,
        attrs: {
          source: "ondevice",
          palette: ["#111111", "#b7ff3c"],
          width: 800,
          height: 600,
        },
      }),
    ]);
    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toContain("palette #111111 #b7ff3c");
    expect(blocks[0]).toContain("800×600");
  });

  it("skips items with nothing to say and caps the item count", () => {
    expect(
      buildMediaContext([item({ description: undefined, attrs: undefined })]),
    ).toEqual([]);
    const many = Array.from({ length: 10 }, (_, i) =>
      item({ name: `f${i}.jpg`, description: `desc ${i}` }),
    );
    expect(buildMediaContext(many)).toHaveLength(MAX_CONTEXT_ITEMS);
  });

  it("labels blocks as visual references (never generation requests)", () => {
    const [block] = buildMediaContext([item({})]);
    expect(block).toMatch(/^Visual reference \(/);
  });
});

describe("buildStyleSnippet", () => {
  it("folds style attributes into one insertable line", () => {
    const s = buildStyleSnippet({
      source: "proxy",
      style: "watercolor",
      lighting: "soft morning",
      mood: "calm",
      palette: ["#aabbcc", "#112233"],
    });
    expect(s).toBe(
      "Style reference: watercolor; soft morning lighting; calm mood; palette #aabbcc #112233",
    );
  });
  it("falls back to the description, and to empty when nothing is known", () => {
    expect(
      buildStyleSnippet({ source: "proxy", description: "Grainy 70s film look." }),
    ).toBe("Style reference: Grainy 70s film look.");
    expect(buildStyleSnippet({ source: "ondevice" })).toBe("");
  });
});

describe("sanitizeName", () => {
  it("strips control characters and middle-ellipsizes long names", () => {
    expect(sanitizeName("bad\u0000name\u001f.jpg")).toBe("badname.jpg");
    const long = `${"a".repeat(50)}.jpg`;
    const out = sanitizeName(long, 20);
    expect(out.length).toBeLessThanOrEqual(21); // head + … + tail
    expect(out).toContain("…");
  });
  it("never returns an empty display name", () => {
    expect(sanitizeName("\u0000\u0001")).toBe("untitled");
  });
});
