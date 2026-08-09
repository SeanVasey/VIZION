import { describe, expect, it } from "vitest";
import { queryDraftsPage } from "@/lib/drafts/queries";
import type { LibraryFilter } from "@/lib/library/paging";

/**
 * A recording stand-in for the Supabase query builder.
 *
 * `queryDraftsPage` is server-only and its interesting behaviour is entirely in
 * WHICH PostgREST filters it emits — the escaping, and the `or` grammar that a
 * comma or paren in a search term can break. Asserting on the emitted calls
 * tests exactly that, without a database.
 *
 * The e2e stub cannot cover this: its `applyFilters` has no `or` support, so an
 * `or=(...)` filter is silently ignored there and a search would appear to work
 * while narrowing nothing.
 */
function fakeSupabase(rows: unknown[] = []) {
  const calls: Array<{ fn: string; args: unknown[] }> = [];
  const builder: Record<string, unknown> = {};
  for (const fn of ["select", "or", "eq", "order", "limit"]) {
    builder[fn] = (...args: unknown[]) => {
      calls.push({ fn, args });
      // `limit` is the last link in the chain and is what gets awaited.
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

const base: LibraryFilter = { view: "drafts", sort: "updated" };
const argsOf = (calls: Array<{ fn: string; args: unknown[] }>, fn: string) =>
  calls.filter((c) => c.fn === fn).map((c) => c.args);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const run = (filter: LibraryFilter, rows: unknown[] = []) => {
  const { calls, client } = fakeSupabase(rows);
  return { done: queryDraftsPage(client as any, filter), calls }; // eslint-disable-line @typescript-eslint/no-explicit-any
};

describe("queryDraftsPage filters", () => {
  it("reads the drafts relation, never prompts", async () => {
    const { done, calls } = run(base);
    await done;
    expect(argsOf(calls, "from")).toEqual([["drafts"]]);
  });

  it("emits no narrowing filters when nothing is set", async () => {
    const { done, calls } = run(base);
    await done;
    expect(argsOf(calls, "or")).toHaveLength(0);
    expect(argsOf(calls, "eq")).toHaveLength(0);
  });

  it("searches BOTH title and body, as one or() rather than two ANDed filters", async () => {
    const { done, calls } = run({ ...base, q: "otters" });
    await done;
    const or = argsOf(calls, "or");
    expect(or).toHaveLength(1);
    const expr = String(or[0]?.[0]);
    // A draft's title is only its first line, so title-only search would miss
    // most of what the draft is about.
    expect(expr).toContain("title.ilike.");
    expect(expr).toContain("body.ilike.");
    expect(expr).toContain("otters");
  });

  it("escapes ilike wildcards so a literal % or _ matches itself", async () => {
    const { done, calls } = run({ ...base, q: "100%_done" });
    await done;
    const expr = String(argsOf(calls, "or")[0]?.[0]);
    // Two layers, both required. escapeLike makes it `100\%\_done` so ilike
    // reads % and _ literally; quoteOrValue then doubles those backslashes for
    // the quoted-value grammar, which PostgREST unescapes back to one. Asserting
    // the wire form keeps both layers honest — dropping either silently widens
    // the search to match far more than the user typed.
    expect(expr).toContain(String.raw`100\\%\\_done`);
  });

  it("quotes the term so a comma or paren cannot break the or() grammar", async () => {
    // Unquoted, the comma would be read as a filter separator and the parens as
    // grammar — turning one search into a different query, or a 400.
    const { done, calls } = run({ ...base, q: 'a, b) or (c "d"' });
    await done;
    const expr = String(argsOf(calls, "or")[0]?.[0]);
    expect(expr).toMatch(/title\.ilike\."/);
    expect(expr).toContain('\\"d\\"');
  });

  it("narrows by model and mode, which are real draft columns", async () => {
    const { done, calls } = run({ ...base, model: "sonnet_5", mode: "expand" });
    await done;
    expect(argsOf(calls, "eq")).toEqual([
      ["target_model", "sonnet_5"],
      ["mode", "expand"],
    ]);
  });

  it("ignores tag and collection — prompts-only, with nothing here to match", async () => {
    const { done, calls } = run({
      ...base,
      tag: "ideas",
      collection: "6f1c1f2e-0000-4000-8000-000000000000",
    });
    await done;
    // Reinterpreting them onto some other column would filter by something the
    // user never asked for.
    expect(argsOf(calls, "eq")).toHaveLength(0);
    expect(argsOf(calls, "or")).toHaveLength(0);
  });

  it("reports the drafts table being absent instead of throwing", async () => {
    const builder: Record<string, unknown> = {};
    for (const fn of ["select", "or", "eq", "order", "limit"]) {
      builder[fn] = () =>
        fn === "limit"
          ? Promise.resolve({ data: null, error: { code: "PGRST205" } })
          : builder;
    }
    const res = await queryDraftsPage(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      { from: () => builder } as any,
      base,
    );
    expect(res).toEqual({ cards: [], nextCursor: null, unavailable: true });
  });

  it("still throws on a real error — an empty list must not mean 'query failed'", async () => {
    const builder: Record<string, unknown> = {};
    for (const fn of ["select", "or", "eq", "order", "limit"]) {
      builder[fn] = () =>
        fn === "limit"
          ? Promise.resolve({ data: null, error: { code: "42501", message: "denied" } })
          : builder;
    }
    await expect(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      queryDraftsPage({ from: () => builder } as any, base),
    ).rejects.toThrow("denied");
  });
});
