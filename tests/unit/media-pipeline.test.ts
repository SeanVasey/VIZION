import { describe, expect, it, vi } from "vitest";
import {
  storeAttachment,
  removeAsset,
  classifyReserveError,
  QUOTA_MESSAGE,
  type MediaStoreDeps,
  type StoreFileInput,
} from "@/lib/media/pipeline";

const FILE: StoreFileInput = {
  blob: new Blob(["x"]),
  name: "beach sunset.jpg",
  mimeType: "image/jpeg",
  sizeBytes: 1024,
  ext: "jpg",
  kind: "image",
  role: "reference",
};

function makeDeps(overrides: Partial<MediaStoreDeps> = {}): MediaStoreDeps {
  return {
    reserve: vi.fn(async () => ({ id: "a1", storagePath: "u1/x.jpg" })),
    uploadObject: vi.fn(async () => {}),
    commit: vi.fn(async () => {}),
    setStatus: vi.fn(async () => {}),
    deleteRow: vi.fn(async () => {}),
    removeObject: vi.fn(async () => ({})),
    ...overrides,
  };
}

describe("storeAttachment (reserve → upload → ready)", () => {
  it("happy path reserves, uploads to the reserved path, then flips ready", async () => {
    const deps = makeDeps();
    const out = await storeAttachment(deps, FILE);
    expect(out).toEqual({ ok: true, assetId: "a1", storagePath: "u1/x.jpg" });
    expect(deps.reserve).toHaveBeenCalledWith({
      kind: "image",
      sizeBytes: 1024,
      originalName: "beach sunset.jpg",
      mimeType: "image/jpeg",
      ext: "jpg",
      role: "reference",
    });
    expect(deps.uploadObject).toHaveBeenCalledWith("u1/x.jpg", FILE.blob, "image/jpeg");
    // The ready-flip is the measured commit (MED-001) — never a bare status
    // update, which would trust the client-declared size.
    expect(deps.commit).toHaveBeenCalledWith("a1");
    expect(deps.setStatus).not.toHaveBeenCalled();
  });

  it("quota rejection surfaces the friendly message and uploads nothing", async () => {
    const deps = makeDeps({
      reserve: vi.fn(async () => {
        throw new Error("quota_exceeded");
      }),
    });
    const out = await storeAttachment(deps, FILE);
    expect(out).toEqual({ ok: false, reason: "quota", message: QUOTA_MESSAGE });
    expect(deps.uploadObject).not.toHaveBeenCalled();
  });

  it("upload failure deletes the pending row (no invisible storage orphans)", async () => {
    const deps = makeDeps({
      uploadObject: vi.fn(async () => {
        throw new Error("network died");
      }),
    });
    const out = await storeAttachment(deps, FILE);
    expect(out).toMatchObject({ ok: false, reason: "upload" });
    // Best-effort object removal precedes the row delete (MED-005): an upload
    // that committed server-side while the client saw an error must not
    // strand an invisible object only account deletion would ever sweep.
    expect(deps.removeObject).toHaveBeenCalledWith("u1/x.jpg");
    expect(deps.deleteRow).toHaveBeenCalledWith("a1");
    expect(deps.setStatus).not.toHaveBeenCalled();
  });

  it("upload failure + row-delete failure marks the row failed (still visible)", async () => {
    const deps = makeDeps({
      uploadObject: vi.fn(async () => {
        throw new Error("network died");
      }),
      deleteRow: vi.fn(async () => {
        throw new Error("also offline");
      }),
    });
    await storeAttachment(deps, FILE);
    expect(deps.setStatus).toHaveBeenCalledWith("a1", "failed");
  });

  it("a failed ready-flip still reports success with a soft note", async () => {
    const deps = makeDeps({
      commit: vi.fn(async () => {
        throw new Error("flaky");
      }),
    });
    const out = await storeAttachment(deps, FILE);
    expect(out).toMatchObject({ ok: true, assetId: "a1", softNote: expect.any(String) });
  });
});

describe("removeAsset (object first, converging)", () => {
  it("removes object then row", async () => {
    const deps = makeDeps();
    expect(await removeAsset(deps, { id: "a1", storagePath: "u1/x.jpg" })).toEqual({
      ok: true,
    });
    expect(deps.removeObject).toHaveBeenCalledWith("u1/x.jpg");
    expect(deps.deleteRow).toHaveBeenCalledWith("a1");
  });

  it("an already-gone object still deletes the row (retry converges)", async () => {
    const deps = makeDeps({
      removeObject: vi.fn(async () => ({ notFound: true })),
    });
    expect(await removeAsset(deps, { id: "a1", storagePath: "p" })).toEqual({
      ok: true,
    });
    expect(deps.deleteRow).toHaveBeenCalled();
  });

  it("a row-delete failure reports retryable state instead of stranding silently", async () => {
    const deps = makeDeps({
      deleteRow: vi.fn(async () => {
        throw new Error("rls hiccup");
      }),
    });
    const out = await removeAsset(deps, { id: "a1", storagePath: "p" });
    expect(out).toMatchObject({ ok: false, stage: "row" });
    if (!out.ok) expect(out.message).toMatch(/retry to clear it/);
  });
});

describe("classifyReserveError", () => {
  it("maps RPC raise messages", () => {
    expect(classifyReserveError("P0001: quota_exceeded")).toBe("quota");
    expect(classifyReserveError("invalid_size")).toBe("invalid");
    expect(classifyReserveError("connection reset")).toBe("reserve");
  });
});
