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
}

main().catch((e) => {
  console.error(`✗ check:db-enum failed: ${e?.message ?? e}`);
  process.exit(1);
});
