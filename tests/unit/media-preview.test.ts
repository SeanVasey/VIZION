import { describe, expect, it, vi } from "vitest";
import {
  assetLabel,
  isThumbnailable,
  isViewable,
  signThumbnails,
  type StoredAsset,
} from "@/lib/media/preview";

/**
 * Stored-media preview helpers: which rows can be opened, what a row is
 * CALLED when the original name was never recorded, and the batch signing
 * that turns private storage paths into viewable URLs.
 */

const NOW = Date.parse("2026-07-28T12:00:00Z");

function asset(over: Partial<StoredAsset> = {}): StoredAsset {
  return {
    id: "a1",
    storage_path: "u1/32264e82-d153-46a3-8638-176b11ff0000.png",
    kind: "image",
    size_bytes: 81920,
    created_at: "2026-07-28T11:00:00Z",
    original_name: null,
    mime_type: "image/png",
    status: "ready",
    ...over,
  };
}

describe("stored-media viewability", () => {
  it("only opens rows whose object actually landed", () => {
    expect(isViewable(asset())).toBe(true);
    expect(isViewable(asset({ status: "pending" }))).toBe(false);
    expect(isViewable(asset({ status: "failed" }))).toBe(false);
  });

  it("thumbnails images only, and only once they are ready", () => {
    expect(isThumbnailable(asset())).toBe(true);
    expect(isThumbnailable(asset({ kind: "video" }))).toBe(false);
    expect(isThumbnailable(asset({ kind: "audio" }))).toBe(false);
    expect(isThumbnailable(asset({ status: "pending" }))).toBe(false);
  });
});

describe("assetLabel", () => {
  it("prefers what the user actually attached", () => {
    expect(assetLabel(asset({ original_name: "IMG_4417.jpeg" }), NOW)).toBe(
      "IMG_4417.jpeg",
    );
  });

  it("sanitizes the stored name (control characters, runaway length)", () => {
    expect(assetLabel(asset({ original_name: "ev\u0007il.png" }), NOW)).toBe("evil.png");
    expect(assetLabel(asset({ original_name: "x".repeat(80) }), NOW)).toHaveLength(40);
  });

  it("names legacy rows for a human instead of showing a UUID", () => {
    const label = assetLabel(asset(), NOW);
    expect(label).toBe("Image · 1 hr ago");
    expect(label).not.toMatch(/32264e82/);
  });

  it("labels the other kinds, and anything unrecognised, honestly", () => {
    expect(assetLabel(asset({ kind: "video" }), NOW)).toBe("Video · 1 hr ago");
    expect(assetLabel(asset({ kind: "audio" }), NOW)).toBe("Audio · 1 hr ago");
    expect(assetLabel(asset({ kind: "model" }), NOW)).toBe("File · 1 hr ago");
  });

  it("treats a blank stored name as no name at all", () => {
    expect(assetLabel(asset({ original_name: "   " }), NOW)).toBe("Image · 1 hr ago");
  });
});

describe("signThumbnails", () => {
  it("signs only the thumbnailable rows and keys the result by asset id", async () => {
    const sign = vi.fn(async (paths: string[]) =>
      paths.map((path) => ({ path, signedUrl: `https://cdn.test/${path}?token=t` })),
    );
    const rows = [
      asset({ id: "img", storage_path: "u1/img.png" }),
      asset({ id: "vid", storage_path: "u1/vid.mp4", kind: "video" }),
      asset({ id: "half", storage_path: "u1/half.png", status: "pending" }),
    ];

    const urls = await signThumbnails(sign, rows, 60);

    expect(sign).toHaveBeenCalledWith(["u1/img.png"], 60);
    expect(urls.get("img")).toBe("https://cdn.test/u1/img.png?token=t");
    expect(urls.has("vid")).toBe(false);
    expect(urls.has("half")).toBe(false);
  });

  it("makes no request when there is nothing to thumbnail", async () => {
    const sign = vi.fn();
    expect((await signThumbnails(sign, [asset({ kind: "audio" })])).size).toBe(0);
    expect(sign).not.toHaveBeenCalled();
  });

  it("degrades per-path failures to a missing thumbnail, not a broken list", async () => {
    const sign = vi.fn(async () => [
      { path: "u1/a.png", signedUrl: null },
      { path: null, signedUrl: null },
      { path: "u1/b.png", signedUrl: "https://cdn.test/b?token=t" },
    ]);
    const urls = await signThumbnails(sign, [
      asset({ id: "a", storage_path: "u1/a.png" }),
      asset({ id: "b", storage_path: "u1/b.png" }),
    ]);
    expect(urls.has("a")).toBe(false);
    expect(urls.get("b")).toBe("https://cdn.test/b?token=t");
  });

  it("survives a signer that rejects outright", async () => {
    const sign = vi.fn(async () => {
      throw new Error("offline");
    });
    await expect(signThumbnails(sign, [asset()])).resolves.toEqual(new Map());
  });

  it("survives a signer that returns nothing", async () => {
    await expect(signThumbnails(async () => null, [asset()])).resolves.toEqual(new Map());
  });
});
