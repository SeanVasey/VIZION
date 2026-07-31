/**
 * Postgres write-error classification.
 *
 * The failure this exists for: the app's `TARGET_MODELS` roster and the DB's
 * `model_target` enum are two sources of truth that can drift, and they drift
 * in exactly one direction — a roster entry ships before its migration is
 * applied. Every write of that value then fails with Postgres 22P02
 * (`invalid input value for enum model_target: "gpt_5_6_terra"`), which used
 * to reach the user verbatim from `savePromptAction`.
 *
 * Classifying it here does two things a raw passthrough can't: users get a
 * sentence they can act on, and the server log names the drift instead of
 * burying it in a generic "write failed".
 */

import { TARGET_MODELS } from "@/lib/constants";

/** Postgres `invalid_text_representation` — the code an unknown enum label hits. */
const INVALID_TEXT_REPRESENTATION = "22P02";

/** `invalid input value for enum <type>: "<value>"` (Postgres' exact wording). */
const ENUM_MISMATCH_RE = /invalid input value for enum ([a-z_][a-z0-9_]*): "([^"]*)"/i;

/** The shape both `PostgrestError` and a plain `{ message }` satisfy. */
export interface DbWriteError {
  code?: string | null;
  message?: string | null;
}

export interface EnumMismatch {
  /** The Postgres enum type that rejected the value, e.g. `model_target`. */
  enumName: string;
  /** The value the app sent, e.g. `gpt_5_6_terra`. */
  value: string;
}

const TARGET_LABELS: Record<string, string> = Object.fromEntries(
  TARGET_MODELS.map((m) => [m.id, m.label]),
);

/**
 * Detect an enum-mismatch write failure. Matches on the message rather than
 * the code alone: 22P02 also covers malformed uuid/numeric/json input, and
 * only the enum shape means "the schema is behind the app".
 */
export function enumMismatch(
  error: DbWriteError | null | undefined,
): EnumMismatch | null {
  if (!error?.message) return null;
  if (error.code && error.code !== INVALID_TEXT_REPRESENTATION) return null;
  const m = ENUM_MISMATCH_RE.exec(error.message);
  if (!m?.[1] || m[2] === undefined) return null;
  return { enumName: m[1], value: m[2] };
}

/**
 * A user-facing sentence for a failed write.
 *
 * The default is the CALLER'S FALLBACK, not the database's message. It used to
 * be the other way round — "RLS and constraint messages are useful as-is" —
 * and they are, to an operator reading a log, not to a user reading a toast.
 * Postgres text carries constraint names, column names, policy names, function
 * signatures and enum type names, and `docs/runbooks/migrations.md` records
 * this exact passthrough putting `invalid input value for enum model_target:
 * "gpt_5_6_terra"` in front of a user. That incident produced the enum branch
 * below; the general leak stayed.
 *
 * Known codes get a sentence someone can act on. Everything else gets the
 * fallback, and the raw text belongs in `writeErrorLogLine` — which is where an
 * operator was always going to look anyway.
 */
export function describeWriteError(
  error: DbWriteError | null | undefined,
  fallback: string,
): string {
  const mismatch = enumMismatch(error);
  if (mismatch) {
    if (mismatch.enumName === "model_target") {
      const label = TARGET_LABELS[mismatch.value] ?? mismatch.value;
      return `${label} isn't available on the server yet — pick another model and try again.`;
    }
    return "That option isn't available on the server yet — pick another and try again.";
  }
  switch (error?.code) {
    // unique_violation — the caller knows which uniqueness it meant, so this
    // stays generic and `describeCollectionError` specialises it.
    case "23505":
      return "That already exists.";
    // foreign_key_violation — the thing being referenced is gone.
    case "23503":
      return "Something it refers to is no longer there — refresh and try again.";
    // check_violation — a value the schema refuses (e.g. a negative amount).
    case "23514":
      return "That value isn't allowed.";
    // insufficient_privilege — an RLS denial. Never echo the policy name.
    case "42501":
      return "You don't have access to that.";
    default:
      return fallback;
  }
}

/**
 * A server-log line for a failed write, naming schema drift explicitly.
 * `console.error` survives production stripping (`removeConsole` keeps
 * error/warn), so this is what an operator actually sees.
 */
export function writeErrorLogLine(
  scope: string,
  what: string,
  error: DbWriteError,
): string {
  const mismatch = enumMismatch(error);
  if (mismatch) {
    return (
      `[${scope}] ${what} failed — SCHEMA DRIFT: '${mismatch.value}' is not in the ` +
      `Postgres '${mismatch.enumName}' enum. A migration in supabase/migrations/ ` +
      `has not been applied to this project. Run 'npm run check:db-enum'.`
    );
  }
  return `[${scope}] ${what} failed: ${error.message ?? "unknown error"}`;
}
