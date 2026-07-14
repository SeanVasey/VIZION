import { describe, it, expect } from "vitest";
import { admitFiles, itemStepLabel, patchItem, type MediaItem } from "@/lib/media/queue";
import { kindForMime } from "@/lib/media/ondevice";

const item = (over: Partial<MediaItem> = {}): MediaItem => ({
  id: "a",
  name: "photo.jpg",
  kind: "image",
  sizeBytes: 1000,
  status: "queued",
  ...over,
});

describe("patchItem", () => {
  it("patches only the matching item, immutably", () => {
    const items = [item(), item({ id: "b", name: "b.png" })];
    const next = patchItem(items, "b", { status: "ready" });
    expect(next).not.toBe(items);
    expect(next[0]!.status).toBe("queued");
    expect(next[1]!.status).toBe("ready");
    expect(items[1]!.status).toBe("queued");
  });
});

describe("admitFiles", () => {
  const file = (name: string, type: string, size: number) => ({ name, type, size });

  it("admits supported files and tags their kind", () => {
    const { admitted, rejected } = admitFiles(
      [file("a.jpg", "image/jpeg", 100), file("b.mp4", "video/mp4", 200)],
      kindForMime,
      0,
      1_000,
    );
    expect(admitted.map((a) => a.kind)).toEqual(["image", "video"]);
    expect(rejected).toEqual([]);
  });

  it("rejects unsupported types with a reason", () => {
    const { admitted, rejected } = admitFiles(
      [file("doc.pdf", "application/pdf", 10)],
      kindForMime,
      0,
      1_000,
    );
    expect(admitted).toEqual([]);
    expect(rejected[0]!.reason).toMatch(/unsupported/i);
  });

  it("halts admissions at the storage quota, accumulating across the selection", () => {
    const { admitted, rejected } = admitFiles(
      [
        file("a.jpg", "image/jpeg", 400),
        file("b.jpg", "image/jpeg", 400),
        file("c.jpg", "image/jpeg", 400),
      ],
      kindForMime,
      100, // already used
      1_000,
    );
    // 100 + 400 + 400 fits; the third would exceed 1000.
    expect(admitted.map((a) => a.file.name)).toEqual(["a.jpg", "b.jpg"]);
    expect(rejected[0]!.file.name).toBe("c.jpg");
    expect(rejected[0]!.reason).toMatch(/storage full/i);
  });
});

describe("itemStepLabel", () => {
  it("labels each stage, naming the model during analysis", () => {
    expect(itemStepLabel(item({ status: "queued" }), "Fable 5")).toBe("Waiting…");
    expect(itemStepLabel(item({ status: "uploading" }), "Fable 5")).toBe("Uploading…");
    expect(itemStepLabel(item({ status: "analyzing" }), "Fable 5")).toBe(
      "Analyzing with Fable 5…",
    );
    expect(itemStepLabel(item({ status: "ready" }), "Fable 5")).toBe("Ready");
    expect(itemStepLabel(item({ status: "error", error: "boom" }), "Fable 5")).toBe(
      "boom",
    );
  });
});
