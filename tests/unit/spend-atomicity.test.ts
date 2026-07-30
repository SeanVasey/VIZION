import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { classifyReserveError } from "@/lib/security/spend";

/**
 * The atomic spend-admission contract.
 *
 * Two separate failures are pinned here, and the second is the reason this file
 * is worth its length.
 *
 * 1. THE RACE. Reading a usage window, calling a provider, then writing the
 *    ledger lets every request that starts inside that gap see the same
 *    balance. `spend_reserve` takes the decision and the hold together under
 *    one per-user advisory lock.
 *
 * 2. THE FIX THAT WAS WORSE THAN THE BUG. The previous attempt (PR #62,
 *    reverted in #63) reserved each request's theoretical worst case — the
 *    target's full output ceiling at list price. Against the shipped $2.00/day
 *    cap that made Fable 5 at max effort reserve $3.20, so EVERY request was
 *    refused on an empty ledger, permanently; Opus 5 on Auto allowed two
 *    enhancements a day. Measured against this project's real history the hold
 *    was 31x the largest request ever made.
 *
 *    So the assertions below are not only "is there a reservation" — they pin
 *    the SIZING RULE and the ADMISSION RULE that made that version unusable,
 *    because both are easy to reintroduce while still looking correct.
 */

const ROOT = join(__dirname, "..", "..");
const MIGRATIONS = join(ROOT, "supabase", "migrations");

const RESERVATIONS = "20260730220000_atomic_spend_reservations.sql";
const AMBIGUITY_FIX = "20260730230000_fix_spend_reserve_ambiguity.sql";

/** Comments stripped and whitespace collapsed, so prose can't satisfy an
 *  assertion and formatting can't break one.
 *
 *  BOTH comment forms have to go. Stripping only `--` lines left the `/** … *\/`
 *  headers in place, and those headers describe the very identifiers being
 *  asserted on — the first draft of this file "proved" that `spend_settle` does
 *  not raise `reservation_not_pending` while matching the sentence explaining
 *  why it doesn't. */
function sql(file: string): string {
  return readFileSync(join(MIGRATIONS, file), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/--[^\n]*/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function source(...parts: string[]): string {
  return readFileSync(join(ROOT, ...parts), "utf8");
}

/** The live definition is the fix migration's; the original shipped the bug. */
const RESERVE_SQL = sql(AMBIGUITY_FIX);
const TABLE_SQL = sql(RESERVATIONS);

describe("admission is atomic", () => {
  it("takes a per-user lock before reading any balance", () => {
    // Without this two parallel calls both read the same totals and both pass.
    expect(RESERVE_SQL).toMatch(/pg_advisory_xact_lock\(\s*hashtext\(\s*'model_spend:'/);
  });

  it("counts holds that have no ledger row yet", () => {
    // The whole point: an in-flight request is invisible to sum(cost_usd).
    expect(RESERVE_SQL).toMatch(
      /sum\(ur\.reserved_usd\)[\s\S]*?from public\.usage_reservations ur[\s\S]*?status = 'pending'/,
    );
  });

  it("reclaims holds from runs that never reported back", () => {
    // A killed function or a vanished client would otherwise eat headroom
    // until midnight.
    expect(RESERVE_SQL).toMatch(
      /update public\.usage_reservations ur set status = 'released'[\s\S]*?created_at < now\(\) - interval '5 minutes'/,
    );
  });
});

describe("the reserve can never approach the cap", () => {
  it("clamps to a share of the cap, and the clamp is applied LAST", () => {
    // greatest() inside least() — so the floor cannot lift the hold above the
    // clamp even when the cap is configured very low. Reversing these is the
    // single edit that would resurrect the Fable 5 failure.
    expect(RESERVE_SQL).toMatch(
      /v_reserve := least\(\s*greatest\(\s*coalesce\(v_p95, 0\) \* c_headroom, c_floor\s*\),\s*p_cap \/ c_cap_share\s*\)/,
    );
  });

  it("derives the size from what the account actually spends", () => {
    expect(RESERVE_SQL).toMatch(/percentile_cont\(0\.95\)/);
    expect(RESERVE_SQL).toMatch(
      /from public\.usage_events ue where ue\.user_id = v_user/,
    );
  });

  it("holds a floor for an account with no history", () => {
    expect(RESERVE_SQL).toMatch(/c_floor constant numeric := 0\.01/);
    expect(RESERVE_SQL).toMatch(/coalesce\(v_p95, 0\)/);
  });

  it("admits on committed spend, not on committed + pending + this hold", () => {
    // `v_today + v_pending >= p_cap` refuses only once the money is actually
    // committed. The reverted version used `v_today + v_pending + p_max_cost >
    // p_cap`, which refused the FIRST request of the day whenever one hold
    // exceeded the cap.
    expect(RESERVE_SQL).toMatch(
      /if v_today \+ v_pending >= p_cap then raise exception 'cap_reached'/,
    );
    expect(RESERVE_SQL).not.toMatch(/v_today \+ v_pending \+/);
  });

  it("never sizes the hold in application code", () => {
    // The estimate lived in `src/lib/security/spend.ts` last time, as
    // `maxEnhanceCost` over a per-target OUTPUT_CEILING table. Sizing belongs
    // where the account's own history is, and where the clamp is enforced.
    const helper = source("src", "lib", "security", "spend.ts");
    expect(helper).not.toMatch(/OUTPUT_CEILING/);
    expect(helper).not.toMatch(/maxEnhanceCost|maxVisionCost/);
    expect(helper).not.toMatch(/computeCost/);
  });
});

describe("settling never loses a spend", () => {
  it("writes the ledger row even when the hold was already swept", () => {
    // The reverted version raised `reservation_not_pending` and wrote nothing,
    // which turns a slow request into free spend.
    expect(RESERVE_SQL).not.toMatch(/reservation_not_pending/);
    expect(TABLE_SQL).not.toMatch(/reservation_not_pending/);
    // The insert must not sit behind an `if not found` guard.
    expect(TABLE_SQL).toMatch(
      /update public\.usage_reservations set status = 'settled'[\s\S]*?insert into public\.usage_events/,
    );
  });

  it("rejects negative amounts inside the settle path too", () => {
    expect(TABLE_SQL).toMatch(/p_token_in < 0 or p_token_out < 0 or p_cost_usd < 0/);
  });
});

describe("the reservation table is unreachable from a client", () => {
  it("has RLS on and no policies", () => {
    expect(TABLE_SQL).toMatch(
      /alter table public\.usage_reservations enable row level security/,
    );
    expect(TABLE_SQL).not.toMatch(/create policy[^;]*usage_reservations/);
  });

  it("revokes the default grants", () => {
    expect(TABLE_SQL).toMatch(
      /revoke all on table public\.usage_reservations from anon, authenticated/,
    );
  });
});

describe("the spend functions are DEFINER, pinned, and narrowly granted", () => {
  const all = TABLE_SQL + " " + RESERVE_SQL;
  for (const fn of ["spend_reserve", "spend_settle", "spend_release"]) {
    it(`${fn} is security definer with a pinned search_path`, () => {
      expect(all).toMatch(
        new RegExp(
          `function public\\.${fn}\\([\\s\\S]*?security definer[\\s\\S]*?set search_path = public`,
        ),
      );
    });

    it(`${fn} is executable by authenticated only`, () => {
      expect(all).toMatch(
        new RegExp(
          `revoke execute on function public\\.${fn}[\\s\\S]*?from anon, public`,
        ),
      );
      expect(all).toMatch(
        new RegExp(`grant execute on function public\\.${fn}[\\s\\S]*?to authenticated`),
      );
    });
  }

  it("aliases the pending-sum so the OUT parameter cannot shadow the column", () => {
    // `returns table (… reserved_usd numeric)` puts an OUT parameter of that
    // name in scope inside the body, so a bare `sum(reserved_usd)` over
    // usage_reservations raised 42702 on EVERY call. It compiled — plpgsql
    // does not resolve body identifiers at create time — so only calling the
    // function surfaced it.
    expect(RESERVE_SQL).toMatch(/sum\(ur\.reserved_usd\)/);
    expect(RESERVE_SQL).not.toMatch(/sum\(reserved_usd\)/);
  });
});

describe("classifyReserveError", () => {
  it("maps the two refusals the RPC raises", () => {
    expect(classifyReserveError("rate_limited")).toBe("rate");
    expect(classifyReserveError("cap_reached")).toBe("cap");
    // Postgres wraps the raise, so the match has to survive surrounding text.
    expect(classifyReserveError("P0001: cap_reached\nCONTEXT: PL/pgSQL …")).toBe("cap");
  });

  it("falls through to db for anything it does not recognise", () => {
    // This is the load-bearing case. Mapping an unknown failure onto "rate" or
    // "cap" would tell a user they are over quota during a database outage,
    // and would hide the outage behind a 429.
    expect(classifyReserveError("connection terminated unexpectedly")).toBe("db");
    expect(classifyReserveError("not_authenticated")).toBe("db");
    expect(classifyReserveError("")).toBe("db");
    expect(classifyReserveError(null)).toBe("db");
    expect(classifyReserveError(undefined)).toBe("db");
  });
});

describe("both model routes reserve, settle and release", () => {
  const routes = [
    ["enhance", source("src", "app", "api", "enhance", "route.ts")],
    ["media", source("src", "app", "api", "media", "route.ts")],
  ] as const;

  for (const [name, src] of routes) {
    it(`${name} reserves before calling a provider`, () => {
      expect(src).toMatch(/await reserveSpend\(supabase\)/);
      expect(src).toMatch(/reservation\.error === "cap"/);
      expect(src).toMatch(/reservation\.error === "rate"/);
    });

    it(`${name} settles with the real cost`, () => {
      expect(src).toMatch(/await settleSpend\(supabase, reservation\.id/);
    });

    it(`${name} releases the hold when nothing was billed`, () => {
      expect(src).toMatch(/await releaseSpend\(supabase, reservation\.id\)/);
    });

    it(`${name} no longer reads the racy usage window`, () => {
      expect(src).not.toMatch(/rpc\(\s*"usage_window"/);
    });

    it(`${name} no longer writes the ledger outside the settle path`, () => {
      expect(src).not.toMatch(/from\(\s*"usage_events"\s*\)\s*\.insert/);
      expect(src).not.toMatch(/rpc\(\s*"record_usage"/);
    });
  }
});

describe("the migrations stay inert for the enum contract", () => {
  it("add no model_target labels", () => {
    for (const file of [RESERVATIONS, AMBIGUITY_FIX]) {
      expect(sql(file)).not.toMatch(/ALTER TYPE model_target/i);
    }
  });
});
