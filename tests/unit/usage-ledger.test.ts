import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The usage-ledger integrity contract.
 *
 * `usage_window()` derives the daily cost cap from `sum(cost_usd)` over
 * `usage_events`. Until 2026-07-30 the account being capped could write that
 * table directly — `authenticated` held INSERT, policy `usage_insert_own`
 * accepted any row it owned, and no constraint bounded the amount. One row with
 * a negative `cost_usd` drove `today_cost` permanently under the cap and made
 * model spend unbounded on the server's provider keys.
 *
 * Two independent controls close it, and this file pins both:
 *
 *   1. a CHECK constraint, so a negative amount cannot exist at ANY privilege
 *      level — including through the SECURITY DEFINER writer below;
 *   2. `record_usage()`, which takes the owner from the verified JWT, so the
 *      direct table grant can be withdrawn entirely.
 *
 * These assert the migration text and the call sites rather than a live
 * database, for the same reason the `model_target` contract does: a running app
 * cannot check the shape of its own schema, and CI has no database.
 */

const ROOT = join(__dirname, "..", "..");
const MIGRATIONS_DIR = join(ROOT, "supabase", "migrations");

function migration(name: string): string {
  return readFileSync(join(MIGRATIONS_DIR, name), "utf8");
}

function source(...parts: string[]): string {
  return readFileSync(join(ROOT, ...parts), "utf8");
}

/** `--` line comments, so prose in a header can't satisfy an assertion. */
function stripComments(sql: string): string {
  return sql.replace(/--[^\n]*/g, "");
}

const INTEGRITY = "20260730200000_usage_ledger_integrity.sql";
const REVOKE = "20260730210000_usage_ledger_revoke.sql";

describe("usage_events cannot be forged", () => {
  const sql = stripComments(migration(INTEGRITY));

  it("constrains all three amount columns, not just cost", () => {
    // token_in/token_out feed `computeCost` on the abort-estimate path, so a
    // negative token count is a second route to a negative charge.
    expect(sql).toMatch(/add\s+constraint\s+usage_events_nonneg_amounts/i);
    expect(sql).toMatch(/cost_usd\s*>=\s*0/i);
    expect(sql).toMatch(/token_in\s*>=\s*0/i);
    expect(sql).toMatch(/token_out\s*>=\s*0/i);
  });

  it("writes the ledger through a SECURITY DEFINER function with a pinned search_path", () => {
    expect(sql).toMatch(/create\s+or\s+replace\s+function\s+public\.record_usage/i);
    expect(sql).toMatch(/security\s+definer/i);
    // An unpinned search_path on a DEFINER function is how a caller-controlled
    // schema hijacks the `insert into public.usage_events` below.
    expect(sql).toMatch(/set\s+search_path\s*=\s*public/i);
  });

  it("derives the owner from auth.uid(), never from an argument", () => {
    // The whole point of the function: there must be nothing owner-shaped for a
    // caller to vary. A `p_user_id` parameter would reintroduce the bug with
    // extra steps.
    expect(sql).toMatch(/v_user\s+uuid\s*:=\s*auth\.uid\(\)/i);
    expect(sql).toMatch(/if\s+v_user\s+is\s+null\s+then\s+raise\s+exception/i);
    expect(sql).not.toMatch(/p_user_id/i);
  });

  it("re-validates the amounts inside the function", () => {
    // Defence in depth: the constraint is the backstop, but the function should
    // reject rather than raise 23514 from underneath a DEFINER call.
    expect(sql).toMatch(/p_token_in\s*<\s*0/i);
    expect(sql).toMatch(/p_token_out\s*<\s*0/i);
    expect(sql).toMatch(/p_cost_usd\s*<\s*0/i);
  });

  it("is executable by authenticated only", () => {
    expect(sql).toMatch(
      /revoke\s+execute\s+on\s+function\s+public\.record_usage[\s\S]*?from\s+anon,\s*public/i,
    );
    expect(sql).toMatch(
      /grant\s+execute\s+on\s+function\s+public\.record_usage[\s\S]*?to\s+authenticated/i,
    );
  });
});

describe("the direct-grant revoke is held for the deploy", () => {
  const raw = migration(REVOKE);

  it("withdraws the write grants and drops the now-unreachable insert policy", () => {
    const sql = stripComments(raw);
    expect(sql).toMatch(
      /revoke\s+insert,\s*update,\s*delete\s+on\s+table\s+public\.usage_events\s+from\s+anon,\s*authenticated/i,
    );
    expect(sql).toMatch(/drop\s+policy\s+if\s+exists\s+usage_insert_own/i);
  });

  it("carries the apply-after-deploy warning in its header", () => {
    // Applying this while the previous build is serving traffic makes every
    // ledger write fail 42501 — which the route swallows into a console.error
    // and still returns 200, so spend would silently stop being counted. The
    // ordering is the whole safety property; it has to be written down where
    // whoever runs `supabase migration up` will read it.
    const header = raw.slice(0, raw.indexOf("revoke"));
    expect(header).toMatch(/DO NOT APPLY/i);
    expect(header).toMatch(/record_usage/);
  });

  it("does not also revoke SELECT — the account still reads its own spend", () => {
    // `usage_select_own` backs the cap readout in the composer; revoking SELECT
    // would blank it.
    const sql = stripComments(raw);
    expect(sql).not.toMatch(/revoke[^;]*\bselect\b[^;]*usage_events/i);
  });
});

describe("both model routes use the function", () => {
  const routes = [
    ["enhance", source("src", "app", "api", "enhance", "route.ts")],
    ["media", source("src", "app", "api", "media", "route.ts")],
  ] as const;

  for (const [name, src] of routes) {
    it(`${name} records usage via the RPC`, () => {
      expect(src).toMatch(/\.rpc\(\s*"record_usage"/);
    });

    it(`${name} no longer inserts into usage_events directly`, () => {
      // This is the assertion that would fail if the RPC call were ever
      // "simplified" back to a table write after the revoke lands — at which
      // point the ledger stops recording and the cap quietly stops working.
      expect(src).not.toMatch(/from\(\s*"usage_events"\s*\)\s*\.insert/);
    });

    it(`${name} still surfaces a failed ledger write to the server log`, () => {
      // The cap is only as good as this write; a silent failure is spend leaking
      // invisibly.
      expect(src).toMatch(/writeErrorLogLine\(\s*"(?:enhance|media)"/);
    });
  }
});

describe("the migration set stays parseable by the enum contract", () => {
  it("adds no model_target labels", () => {
    // `model-target-enum.test.ts` replays every migration's ALTER TYPE onto a
    // baseline. These two must be inert there, or they would shift the enum
    // replay and fail a contract they have nothing to do with.
    for (const file of [INTEGRITY, REVOKE]) {
      const sql = stripComments(migration(file));
      expect(sql).not.toMatch(/ALTER\s+TYPE\s+model_target/i);
    }
  });

  it("keeps both files in the migrations directory under the timestamp convention", () => {
    const files = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith(".sql"));
    expect(files).toContain(INTEGRITY);
    expect(files).toContain(REVOKE);
    // Lexical order is applied order; the revoke must sort after the function
    // it depends on.
    expect([INTEGRITY, REVOKE].sort()).toEqual([INTEGRITY, REVOKE]);
  });
});
