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
});

describe("libraryHref", () => {
  it("keeps the default URL clean", () => {
    expect(libraryHref({ view: "all", sort: "updated" })).toBe("/library");
  });

  it("round-trips through parseLibraryParams", () => {
    const filter = {
      q: "spec",
      model: "gpt_5_6_sol" as const,
      view: "favorites" as const,
      sort: "title" as const,
    };
    const href = libraryHref(filter);
    const sp = Object.fromEntries(new URL(`https://x${href}`).searchParams.entries());
    expect(parseLibraryParams(sp)).toEqual(filter);
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
      }),
    ).toBe(5);
  });
});

describe("cursor", () => {
  it("round-trips a timestamp + id", () => {
    const c = encodeCursor("2026-07-27T10:00:00+00:00", "abc-123");
    expect(decodeCursor(c)).toEqual({
      value: "2026-07-27T10:00:00+00:00",
      id: "abc-123",
    });
  });

  it("round-trips title values containing punctuation", () => {
    const c = encodeCursor('Weird, "title" (v2)', "id-9");
    expect(decodeCursor(c)).toEqual({ value: 'Weird, "title" (v2)', id: "id-9" });
  });

  it("rejects garbage", () => {
    expect(decodeCursor("")).toBeNull();
    expect(decodeCursor("no-separator")).toBeNull();
    expect(decodeCursor("value-missing")).toBeNull();
  });
});
