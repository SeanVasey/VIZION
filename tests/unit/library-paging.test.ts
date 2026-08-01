import { describe, expect, it } from "vitest";
import {
  parseLibraryParams,
  libraryHref,
  countActiveFilters,
  encodeCursor,
  decodeCursor,
} from "@/lib/library/paging";

describe("parseLibraryParams", () => {
  it("defaults to the all/updated view with no params", () => {
    expect(parseLibraryParams(undefined)).toEqual({ view: "all", sort: "updated" });
    expect(parseLibraryParams({})).toEqual({ view: "all", sort: "updated" });
  });

  it("accepts valid values and takes the first of arrays", () => {
    const f = parseLibraryParams({
      q: " launch ",
      model: "opus_5",
      mode: "target",
      tag: "marketing",
      view: ["favorites", "archived"],
      sort: "title",
    });
    expect(f).toEqual({
      q: "launch",
      model: "opus_5",
      mode: "target",
      tag: "marketing",
      view: "favorites",
      sort: "title",
    });
  });

  it("drops garbage back to defaults instead of erroring", () => {
    const f = parseLibraryParams({
      model: "not_a_model",
      mode: "explode",
      view: "everything",
      sort: "chaos",
      q: "",
    });
    expect(f).toEqual({ view: "all", sort: "updated" });
  });

  it("caps oversized inputs", () => {
    const f = parseLibraryParams({ q: "x".repeat(500) });
    expect(f.q!.length).toBe(200);
  });

  it("accepts a uuid-shaped collection and drops anything else", () => {
    const id = "3fa85f64-5717-4562-b3fc-2c963f66afa6";
    expect(parseLibraryParams({ collection: id }).collection).toBe(id);
    // Injection-shaped and truncated values never reach the query layer.
    expect(parseLibraryParams({ collection: "DROP TABLE prompts" }).collection)
      .toBeUndefined();
    expect(parseLibraryParams({ collection: "3fa85f64" }).collection).toBeUndefined();
  });
});

describe("libraryHref", () => {
  it("keeps the default URL clean", () => {
    expect(libraryHref({ view: "all", sort: "updated" })).toBe("/library");
  });

  it("round-trips through parseLibraryParams", () => {
    const filter = {
      q: "spec",
      model: "gpt_5_6_sol" as const,
      collection: "3fa85f64-5717-4562-b3fc-2c963f66afa6",
      view: "favorites" as const,
      sort: "title" as const,
    };
    const href = libraryHref(filter);
    const sp = Object.fromEntries(new URL(`https://x${href}`).searchParams.entries());
    expect(parseLibraryParams(sp)).toEqual(filter);
  });

  it("omits the collection param when absent", () => {
    expect(libraryHref({ view: "all", sort: "updated" })).not.toContain("collection");
  });
});

describe("countActiveFilters", () => {
  it("counts narrowing selections, not search", () => {
    expect(countActiveFilters({ view: "all", sort: "updated", q: "hi" })).toBe(0);
    expect(
      countActiveFilters({
        view: "favorites",
        sort: "title",
        model: "opus_5",
        mode: "polish",
        tag: "x",
        collection: "3fa85f64-5717-4562-b3fc-2c963f66afa6",
      }),
    ).toBe(6);
  });
});

describe("cursor", () => {
  const ID = "5b4c1a52-8a3e-4a5e-9f37-2f6a2f0a1c9d";

  it("round-trips a timestamp + id", () => {
    const c = encodeCursor("2026-07-27T10:00:00+00:00", ID);
    expect(decodeCursor(c)).toEqual({
      value: "2026-07-27T10:00:00+00:00",
      id: ID,
    });
  });

  it("round-trips title values containing punctuation", () => {
    const c = encodeCursor('Weird, "title" (v2)', ID);
    expect(decodeCursor(c)).toEqual({ value: 'Weird, "title" (v2)', id: ID });
  });

  it("rejects garbage", () => {
    expect(decodeCursor("")).toBeNull();
    expect(decodeCursor("no-separator")).toBeNull();
    expect(decodeCursor("value-missing")).toBeNull();
  });

  it("rejects a tampered id — the injection surface (SEC-004)", () => {
    // Both halves are interpolated into PostgREST .or() grammar; the id the
    // server minted is always a UUID, so anything else is a crafted cursor.
    expect(decodeCursor(encodeCursor("2026-01-01", "x,id.not.is.null"))).toBeNull();
    expect(decodeCursor(encodeCursor("2026-01-01", "abc-123"))).toBeNull();
  });
});
