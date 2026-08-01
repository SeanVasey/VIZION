import { describe, expect, it } from "vitest";
import { queryLibraryPage } from "@/lib/library/queries";
import { LIBRARY_PAGE_SIZE, encodeCursor } from "@/lib/library/paging";
import type { LibraryFilter } from "@/lib/library/paging";

/**
 * The library twin of drafts-queries.test.ts (audit LIB-008): the drafts page
 * builder was tested and its page-seam bug got fixed; the library builder was
 * not, and the identical bug shipped there. Same recording fake — the
 * interesting behavior is WHICH PostgREST filters are emitted.
 */
function fakeSupabase(rows: unknown[] = []) {
  const calls: Array<{ fn: string; args: unknown[] }> = [];
  const builder: Record<string, unknown> = {};
  for (const fn of [
    "select",
    "or",
    "eq",
    "is",
    "not",
    "contains",
    "ilike",
    "order",
    "limit",
  ]) {
    builder[fn] = (...args: unknown[]) => {
      calls.push({ fn, args });
      return fn === "limit" ? Promise.resolve({ data: rows, error: null }) : builder;
    };
  }
  return {
    calls,
    client: {
      from: (table: string) => (calls.push({ fn: "from", args: [table] }), builder),
    },
  };
}

const base: LibraryFilter = { view: "all", sort: "updated" };
const argsOf = (calls: Array<{ fn: string; args: unknown[] }>, fn: string) =>
  calls.filter((c) => c.fn === fn).map((c) => c.args);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const run = (filter: LibraryFilter, rows: unknown[] = [], cursor?: string) => {
  const { calls, client } = fakeSupabase(rows);
  return { done: queryLibraryPage(client as any, filter, cursor), calls }; // eslint-disable-line @typescript-eslint/no-explicit-any
};

function row(id: string, updated_at: string) {
  return {
    id,
    title: `t-${id}`,
    target_model: "opus_5",
    tags: [],
    created_at: updated_at,
    updated_at,
    favorite: false,
    archived_at: null,
    preview: null,
    current_mode: null,
    collection_id: null,
    prompt_versions: [{ count: 1 }],
  };
}

describe("queryLibraryPage filters", () => {
  it("always excludes soft-deleted prompts and reads prompts only", async () => {
    const { done, calls } = run(base);
    await done;
    expect(argsOf(calls, "from")).toEqual([["prompts"]]);
    expect(argsOf(calls, "is")).toContainEqual(["deleted_at", null]);
  });

  it("the default view hides archived; the archived view requires them", async () => {
    const a = run(base);
    await a.done;
    expect(argsOf(a.calls, "is")).toContainEqual(["archived_at", null]);

    const b = run({ ...base, view: "archived" });
    await b.done;
    expect(argsOf(b.calls, "not")).toContainEqual(["archived_at", "is", null]);
  });

  it("escapes ilike wildcards in the search term", async () => {
    const { done, calls } = run({ ...base, q: "50%_done" });
    await done;
    expect(argsOf(calls, "ilike")).toEqual([["title", "%50\\%\\_done%"]]);
  });

  it("fetches PAGE_SIZE+1 as the has-more sentinel and trims the page", async () => {
    const rows = Array.from({ length: LIBRARY_PAGE_SIZE + 1 }, (_, i) =>
      row(`p${i}`, `2026-07-0${(i % 9) + 1}`),
    );
    const { done, calls } = run(base, rows);
    const res = await done;
    expect(argsOf(calls, "limit")).toEqual([[LIBRARY_PAGE_SIZE + 1]]);
    expect(res.cards).toHaveLength(LIBRARY_PAGE_SIZE);
    expect(res.nextCursor).not.toBeNull();
  });

  it("returns no cursor when the page is not full", async () => {
    const res = await run(base, [row("p1", "2026-07-01")]).done;
    expect(res.cards).toHaveLength(1);
    expect(res.nextCursor).toBeNull();
  });

  it("pages from the supplied cursor via the keyset or() filter", async () => {
    const cursor = encodeCursor("2026-07-01T00:00:00Z", "p9");
    const { done, calls } = run(base, [], cursor);
    await done;
    const or = argsOf(calls, "or");
    expect(or).toHaveLength(1);
    expect(String(or[0]![0])).toContain("updated_at.lt.");
    expect(String(or[0]![0])).toContain("id.lt.");
  });

  it("propagates a PostgREST error instead of returning an empty page", async () => {
    const calls: Array<{ fn: string; args: unknown[] }> = [];
    const builder: Record<string, unknown> = {};
    for (const fn of ["select", "is", "order", "limit"]) {
      builder[fn] = (...args: unknown[]) => {
        calls.push({ fn, args });
        return fn === "limit"
          ? Promise.resolve({ data: null, error: { message: "boom" } })
          : builder;
      };
    }
    const client = { from: () => builder };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await expect(queryLibraryPage(client as any, base)).rejects.toThrow("boom");
  });
});
