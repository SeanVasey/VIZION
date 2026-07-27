#!/usr/bin/env node
/**
 * Preflight: does the hosted Postgres `model_target` enum know every model the
 * app offers?
 *
 * `tests/unit/model-target-enum.test.ts` proves the roster, the migrations, and
 * the generated types agree with each other — but all three can agree while the
 * hosted project is behind on applying a migration. That gap shipped once: the
 * GPT-5.6 Luna/Terra + Kimi K3 + MiniMax M3 migration was committed and never
 * applied, so those four targets failed every DB write with Postgres 22P02
 * while every CI gate stayed green.
 *
 * The probe is read-only. PostgREST casts a filter value to the column's enum
 * during planning, so `?target_model=eq.<id>&limit=0` returns 400 with
 * "invalid input value for enum model_target" when the label is missing and 200
 * when it exists. No rows are read (RLS scopes them away anyway) and nothing is
 * written.
 *
 *   node scripts/check-model-enum.mjs [--strict]
 *
 * Reads NEXT_PUBLIC_SUPABASE_URL plus SUPABASE_SERVICE_ROLE_KEY (preferred) or
 * NEXT_PUBLIC_SUPABASE_ANON_KEY, from the environment or .env.local. Without
 * credentials it reports SKIPPED and exits 0, unless --strict makes that fatal.
 */

import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const STRICT = process.argv.includes("--strict");

/** Minimal `.env.local` reader — no dependency, and it never overrides real env. */
function loadEnvLocal() {
  const file = join(ROOT, ".env.local");
  if (!existsSync(file)) return;
  for (const line of readFileSync(file, "utf8").split("\n")) {
    const m = /^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)$/i.exec(line);
    if (!m) continue;
    const key = m[1];
    if (process.env[key] !== undefined) continue;
    process.env[key] = m[2].trim().replace(/^["']|["']$/g, "");
  }
}

/** The roster ids, read straight from the single source of truth. */
function readRosterIds() {
  const src = readFileSync(join(ROOT, "src", "lib", "constants.ts"), "utf8");
  const block = /export const TARGET_MODELS = \[([\s\S]*?)\n\] as const/.exec(src);
  if (!block) throw new Error("Could not locate TARGET_MODELS in src/lib/constants.ts");
  const ids = [...block[1].matchAll(/\bid:\s*"([^"]+)"/g)].map((m) => m[1]);
  if (ids.length === 0) throw new Error("TARGET_MODELS parsed to zero ids");
  return ids;
}

const MISSING_ENUM_RE = /invalid input value for enum model_target/i;

/**
 * Columns the app's queries select that arrived via later migrations — the
 * same committed-but-unapplied drift class as the enum, probed the same
 * read-only way (`?select=<col>&limit=0` → 200 present / 400 42703 missing).
 * Append here whenever a migration adds a column the client selects.
 */
const COLUMN_PROBES = [
  {
    table: "media_assets",
    columns: ["original_name", "mime_type", "role", "status"],
    migration: "20260727120000_media_roles_and_reservation.sql",
  },
  {
    table: "prompts",
    columns: ["favorite", "archived_at", "deleted_at", "preview", "current_mode"],
    migration: "20260727130000_library_organization.sql",
  },
  {
    table: "prompt_versions",
    columns: ["content_hash"],
    migration: "20260727130000_library_organization.sql",
  },
  {
    table: "prompts",
    columns: ["collection_id"],
    migration: "20260727140000_collections.sql",
  },
  {
    table: "collections",
    columns: ["id", "name"],
    migration: "20260727140000_collections.sql",
  },
];

/** RPC functions the app calls — a missing function is PostgREST PGRST202.
 *  `args` must match the real signature: PGRST202 means "no function with
 *  THESE parameters", so an empty body would read as missing even when the
 *  function exists. The probe values never execute — anon lacks EXECUTE
 *  (42501) and an authenticated caller would fail validation first. */
const FUNCTION_PROBES = [
  {
    fn: "media_reserve",
    args: {
      p_kind: "image",
      p_size_bytes: 1,
      p_original_name: "probe",
      p_mime_type: "probe",
      p_ext: "bin",
    },
    migration: "20260727120000_media_roles_and_reservation.sql",
  },
];

/** `present` | `missing` | `{ error }` for one label. */
async function probe(baseUrl, key, id) {
  const url = `${baseUrl}/rest/v1/prompts?select=id&limit=0&target_model=eq.${encodeURIComponent(id)}`;
  const res = await fetch(url, {
    headers: { apikey: key, authorization: `Bearer ${key}` },
  });
  if (res.ok) return "present";
  const body = await res.text();
  if (MISSING_ENUM_RE.test(body)) return "missing";
  return { error: `HTTP ${res.status}: ${body.slice(0, 300)}` };
}

/** `present` | `missing` | `{ error }` for a table's migrated columns. */
async function probeColumns(baseUrl, key, { table, columns }) {
  const url = `${baseUrl}/rest/v1/${table}?select=${columns.join(",")}&limit=0`;
  const res = await fetch(url, {
    headers: { apikey: key, authorization: `Bearer ${key}` },
  });
  if (res.ok) return "present";
  const body = await res.text();
  // 42703 = undefined column — the unapplied-migration signature.
  if (res.status === 400 && /does not exist|42703/i.test(body)) return "missing";
  // PGRST205 = unknown table — the whole CREATE TABLE migration is missing.
  if (res.status === 404 && /PGRST205|could not find the table/i.test(body)) {
    return "missing";
  }
  return { error: `HTTP ${res.status}: ${body.slice(0, 300)}` };
}

/** `present` | `missing` | `{ error }` for an RPC function — only PGRST202
 *  ("could not find the function … with these parameters") means the
 *  migration wasn't applied; any other rejection (permission denied,
 *  validation) proves it exists, which is all this probe asserts. */
async function probeFunction(baseUrl, key, { fn, args }) {
  const res = await fetch(`${baseUrl}/rest/v1/rpc/${fn}`, {
    method: "POST",
    headers: {
      apikey: key,
      authorization: `Bearer ${key}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(args ?? {}),
  });
  if (res.ok) return "present";
  const body = await res.text();
  if (res.status === 404 && /PGRST202|could not find the function/i.test(body)) {
    return "missing";
  }
  return "present";
}

async function main() {
  loadEnvLocal();
  const baseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.replace(/\/+$/, "");
  const key =
    process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!baseUrl || !key) {
    const msg =
      "check:db-enum SKIPPED — set NEXT_PUBLIC_SUPABASE_URL and a Supabase key " +
      "(service-role preferred) to verify the hosted enum.";
    if (STRICT) {
      console.error(`✗ ${msg}`);
      process.exit(1);
    }
    console.warn(`• ${msg}`);
    return;
  }

  const ids = readRosterIds();
  const results = await Promise.all(
    ids.map(async (id) => ({ id, outcome: await probe(baseUrl, key, id) })),
  );

  const missing = results.filter((r) => r.outcome === "missing").map((r) => r.id);
  const broken = results.filter((r) => typeof r.outcome === "object");

  if (broken.length > 0) {
    console.error("✗ check:db-enum could not complete — the probe itself failed:");
    for (const b of broken) console.error(`    ${b.id}: ${b.outcome.error}`);
    process.exit(1);
  }

  if (missing.length > 0) {
    console.error(
      `✗ SCHEMA DRIFT — ${missing.length} of ${ids.length} targets are missing from the ` +
        `hosted 'model_target' enum:\n` +
        missing.map((id) => `    ${id}`).join("\n") +
        `\n\n  Every DB write for these targets fails with Postgres 22P02: saving to the\n` +
        `  library errors, and the usage-ledger write fails so their spend never counts\n` +
        `  against the daily cost cap.\n\n` +
        `  Fix: apply the pending migration(s) in supabase/migrations/ to this project.`,
    );
    process.exit(1);
  }

  console.log(`✓ hosted 'model_target' enum knows all ${ids.length} roster targets.`);

  // --- Migrated columns + RPC functions (same drift class, same probe). ---
  let drifted = false;
  for (const cp of COLUMN_PROBES) {
    const outcome = await probeColumns(baseUrl, key, cp);
    if (outcome === "present") {
      console.log(`✓ hosted '${cp.table}' has ${cp.columns.join(", ")}.`);
    } else if (outcome === "missing") {
      drifted = true;
      console.error(
        `✗ SCHEMA DRIFT — '${cp.table}' is missing migrated column(s) ` +
          `${cp.columns.join(", ")}.\n  Fix: apply supabase/migrations/${cp.migration}.`,
      );
    } else {
      console.error(`✗ column probe for '${cp.table}' failed: ${outcome.error}`);
      process.exit(1);
    }
  }
  for (const fp of FUNCTION_PROBES) {
    const outcome = await probeFunction(baseUrl, key, fp);
    if (outcome === "present") {
      console.log(`✓ hosted function '${fp.fn}' exists.`);
    } else {
      drifted = true;
      console.error(
        `✗ SCHEMA DRIFT — RPC function '${fp.fn}' is missing.\n` +
          `  Fix: apply supabase/migrations/${fp.migration}.`,
      );
    }
  }
  if (drifted) process.exit(1);
}

main().catch((e) => {
  console.error(`✗ check:db-enum failed: ${e?.message ?? e}`);
  process.exit(1);
});
