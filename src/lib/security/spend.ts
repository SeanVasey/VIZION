/**
 * Atomic spend admission for the model routes.
 *
 * The cap used to be read-then-act: a route read the usage window, called a
 * provider, and only then wrote the ledger row. Every request that started
 * inside that gap saw the same balance, so N parallel requests all passed. The
 * in-memory burst guard in front of it is per serverless instance and cannot
 * converge on a platform that spins a fresh instance per concurrent call.
 *
 * `spend_reserve` closes it: admission and the hold are taken together under one
 * per-user advisory lock, so a concurrent request sees the hold even though no
 * ledger row exists yet. The run then either settles (recording what it really
 * cost and dropping the hold) or releases.
 *
 * NOTE ON SIZING — this module deliberately does NOT estimate a cost. The
 * previous attempt at this computed each request's theoretical worst case here
 * and reserved that; on the shipped $2.00/day cap it made Fable 5 at max effort
 * permanently unusable, because one hold ($3.20) exceeded the whole cap. The
 * reserve is a concurrency guard, not a worst-case bound, so the database sizes
 * it from what the account actually spends and clamps it to a fraction of the
 * cap. See `supabase/migrations/20260730203605_atomic_spend_reservations.sql`.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import type { TargetModelId } from "@/lib/constants";
import { COST_CAP_USD_PER_DAY, RATE_LIMIT_PER_MIN } from "@/lib/providers/config";

type Db = SupabaseClient<Database>;

/** Why admission was refused. `db` covers everything unclassified. */
export type ReserveFailure = "rate" | "cap" | "db";

export interface Reservation {
  /** Pass to `settleSpend` or `releaseSpend`. */
  id: string;
  /** Committed spend so far today — what the client shows against the cap. */
  todayCost: number;
  /** The hold taken, for diagnostics. */
  reservedUsd: number;
}

/**
 * Map a `spend_reserve` failure onto the route's response.
 *
 * The RPC signals refusal by raising, so the reason arrives as message text.
 * Pure and exported so the mapping is testable without a database — an
 * unrecognised message MUST fall through to `db` (a 500), never to a 429, or a
 * genuine outage would read to the user as "you're going too fast".
 */
export function classifyReserveError(message: string | null | undefined): ReserveFailure {
  if (!message) return "db";
  if (message.includes("rate_limited")) return "rate";
  if (message.includes("cap_reached")) return "cap";
  return "db";
}

/** Admit one model call, or explain why not. */
export async function reserveSpend(
  supabase: Db,
): Promise<Reservation | { error: ReserveFailure }> {
  const { data, error } = await supabase.rpc("spend_reserve", {
    p_cap: COST_CAP_USD_PER_DAY,
    p_rate_limit: RATE_LIMIT_PER_MIN,
    p_rate_seconds: 60,
  });
  if (error) return { error: classifyReserveError(error.message) };
  const row = data?.[0];
  if (!row) return { error: "db" };
  return {
    id: row.reservation_id,
    todayCost: Number(row.today_cost),
    reservedUsd: Number(row.reserved_usd),
  };
}

/**
 * Record what the call actually cost and drop its hold.
 *
 * The ledger write inside `spend_settle` is not conditional on the hold still
 * being pending: a run slow enough to be swept still spent the money, and spend
 * the cap cannot see is worse than a stale hold.
 */
export async function settleSpend(
  supabase: Db,
  reservationId: string,
  usage: {
    target: TargetModelId;
    mode: string;
    modelUsed: string;
    tokenIn: number;
    tokenOut: number;
    costUsd: number;
    /** Counts came from the ~4 chars/token fallback, not the provider —
     *  ledgered as an estimate, never presented as a measurement (INV-04). */
    estimated?: boolean;
  },
) {
  return supabase.rpc("spend_settle", {
    p_reservation_id: reservationId,
    p_target: usage.target,
    p_mode: usage.mode,
    p_model_used: usage.modelUsed,
    p_token_in: usage.tokenIn,
    p_token_out: usage.tokenOut,
    p_cost_usd: usage.costUsd,
    p_estimated: usage.estimated ?? false,
  });
}

/**
 * Drop a hold for a call that produced no billable usage.
 *
 * Not strictly required — `spend_reserve` sweeps holds older than five minutes —
 * but without it a user who cancels twice in a row is refused on their third
 * attempt for no reason they can see.
 */
export async function releaseSpend(supabase: Db, reservationId: string) {
  return supabase.rpc("spend_release", { p_reservation_id: reservationId });
}
