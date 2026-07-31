import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { LEGACY_TARGET_IDS, TARGET_MODELS, type TargetModelId } from "@/lib/constants";
import {
  describeWriteError,
  enumMismatch,
  writeErrorLogLine,
} from "@/lib/supabase/errors";
import type { Enums } from "@/lib/supabase/database.types";

/**
 * The `model_target` enum contract.
 *
 * Three sources have to agree on the model-id vocabulary: the roster in
 * `src/lib/constants.ts`, the generated `database.types.ts` union, and the
 * Postgres enum itself. Nothing pinned them, and they drifted: the GPT-5.6
 * Luna/Terra + Kimi K3 + MiniMax M3 migration was committed but never applied
 * to the hosted project, so those four targets 22P02'd on every DB write while
 * lint, typecheck, tests, and build all stayed green.
 *
 * These tests close the two halves a running app can't check for itself:
 * the roster must not name a value no migration creates, and the generated
 * types must not claim values the migrations don't produce. The third half —
 * "is the hosted project actually caught up?" — needs a live connection and
 * lives in `scripts/check-model-enum.mjs` (`npm run check:db-enum`).
 */

const ROOT = join(__dirname, "..", "..");
const MIGRATIONS_DIR = join(ROOT, "supabase", "migrations");

/**
 * The enum's labels as of the last migration that predates this repo's
 * `supabase/migrations/` directory. The P2 base schema (`p2_auth_profile_schema`,
 * which holds the original `CREATE TYPE model_target`) was applied straight to
 * the hosted project and exists only in its migration ledger, so the replay
 * below needs it declared. Verified against the live enum: replaying every
 * in-repo migration onto this baseline reproduces the hosted label order exactly.
 */
const BASELINE_LABELS = ["opus_4_8", "gpt_5_5", "gemini_pro_3_1"];

type EnumOp =
  | { kind: "rename"; from: string; to: string; migration: string }
  | { kind: "add"; value: string; after?: string; before?: string; migration: string };

/** Strip `--` line comments so prose in a migration header can't parse as DDL. */
function stripComments(sql: string): string {
  return sql.replace(/--[^\n]*/g, "");
}

const RENAME_RE =
  /ALTER\s+TYPE\s+model_target\s+RENAME\s+VALUE\s+'([^']+)'\s+TO\s+'([^']+)'/gi;
const ADD_RE =
  /ALTER\s+TYPE\s+model_target\s+ADD\s+VALUE\s+(?:IF\s+NOT\s+EXISTS\s+)?'([^']+)'(?:\s+(AFTER|BEFORE)\s+'([^']+)')?/gi;

/** Every `model_target` mutation across the migrations, in applied order. */
function readEnumOps(): EnumOp[] {
  const files = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort(); // filenames are timestamp-prefixed, so lexical === applied order

  const ops: EnumOp[] = [];
  for (const file of files) {
    const sql = stripComments(readFileSync(join(MIGRATIONS_DIR, file), "utf8"));
    // Interleave by position so a rename and an add in the same file keep
    // their written order (20260724 renames opus_4_8 then adds AFTER 'opus_5').
    const found: { at: number; op: EnumOp }[] = [];
    for (const m of sql.matchAll(RENAME_RE)) {
      found.push({
        at: m.index,
        op: { kind: "rename", from: m[1]!, to: m[2]!, migration: file },
      });
    }
    for (const m of sql.matchAll(ADD_RE)) {
      const position = m[2]?.toUpperCase();
      found.push({
        at: m.index,
        op: {
          kind: "add",
          value: m[1]!,
          ...(position === "AFTER" ? { after: m[3]! } : {}),
          ...(position === "BEFORE" ? { before: m[3]! } : {}),
          migration: file,
        },
      });
    }
    found.sort((a, b) => a.at - b.at);
    ops.push(...found.map((f) => f.op));
  }
  return ops;
}

/** Replay the migrations onto the baseline, mirroring Postgres' semantics. */
function replayEnum(ops: EnumOp[]): string[] {
  const labels = [...BASELINE_LABELS];
  for (const op of ops) {
    if (op.kind === "rename") {
      const i = labels.indexOf(op.from);
      if (i === -1) {
        throw new Error(
          `${op.migration}: RENAME VALUE '${op.from}' — that value does not exist at this point in the migration history.`,
        );
      }
      labels[i] = op.to; // RENAME keeps the value's sort position (and its rows)
    } else {
      if (labels.includes(op.value)) continue; // ADD VALUE IF NOT EXISTS
      const anchor = op.after ?? op.before;
      if (anchor === undefined) {
        labels.push(op.value);
        continue;
      }
      const i = labels.indexOf(anchor);
      if (i === -1) {
        throw new Error(
          `${op.migration}: ADD VALUE '${op.value}' anchored to '${anchor}', which does not exist at this point in the migration history.`,
        );
      }
      labels.splice(op.after ? i + 1 : i, 0, op.value);
    }
  }
  return labels;
}

/** The `model_target` labels the generated types file declares. */
function readGeneratedLabels(): string[] {
  const src = readFileSync(
    join(ROOT, "src", "lib", "supabase", "database.types.ts"),
    "utf8",
  );
  const block = /^\s*model_target:\s*([\s\S]*?);$/m.exec(src);
  if (!block?.[1]) throw new Error("No `model_target` union found in database.types.ts");
  return [...block[1].matchAll(/"([^"]+)"/g)].map((m) => m[1]!);
}

const ops = readEnumOps();
const migratedLabels = replayEnum(ops);
const rosterIds: string[] = TARGET_MODELS.map((m) => m.id);

describe("model_target enum contract", () => {
  it("replays every migration cleanly onto the pre-repo baseline", () => {
    // replayEnum throws on a rename/anchor that references a value which does
    // not exist yet — i.e. a migration that could never have applied.
    expect(ops.length).toBeGreaterThan(0);
    expect(new Set(migratedLabels).size).toBe(migratedLabels.length);
  });

  it("creates exactly the ids the roster offers (a roster entry needs a migration)", () => {
    const missingInDb = rosterIds.filter((id) => !migratedLabels.includes(id));
    const orphanedInDb = migratedLabels.filter((l) => !rosterIds.includes(l));
    // Named separately so a failure says WHICH side is behind. `missingInDb`
    // non-empty is the bug that shipped: the app offers a model the enum lacks.
    expect({ missingInDb, orphanedInDb }).toEqual({ missingInDb: [], orphanedInDb: [] });
  });

  it("keeps the generated types union equal to the migrated enum", () => {
    // The types file is generated from the live project — if it disagrees with
    // the migrations, either it was hand-edited or it was generated against a
    // project that has not caught up. Order is not compared: a TS union is a
    // set, while Postgres' label order is only a sort order.
    const generated = readGeneratedLabels();
    expect(new Set(generated).size).toBe(generated.length);
    expect([...generated].sort()).toEqual([...migratedLabels].sort());
  });

  it("pins the generated union to the roster union at compile time", () => {
    // This assignment is the real assertion: if the two unions diverge,
    // `Equal<…>` resolves to `false` and `npm run typecheck` fails here.
    type Equal<A, B> =
      (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
    const unionsMatch: Equal<Enums<"model_target">, TargetModelId> = true;
    expect(unionsMatch).toBe(true);
  });

  it("maps every renamed-away id in LEGACY_TARGET_IDS to a current target", () => {
    // A rename with no legacy entry leaves stale localStorage pointing at an id
    // that no longer exists, which 400s on /api/enhance (lessons: 2026-07).
    for (const op of ops) {
      if (op.kind !== "rename") continue;
      const mapped = LEGACY_TARGET_IDS[op.from];
      expect(
        mapped,
        `${op.migration} renamed '${op.from}' with no LEGACY_TARGET_IDS entry`,
      ).toBeDefined();
      expect(
        rosterIds,
        `LEGACY_TARGET_IDS['${op.from}'] → '${mapped}' is not a live target`,
      ).toContain(mapped);
    }
  });

  it("keeps the migration set inside the ids the enhance route accepts", () => {
    // /api/enhance and savePromptAction both gate on TARGET_MODELS, so a label
    // the DB has but the roster dropped can never be written — it would be a
    // dead enum value, not a runtime failure. Asserted separately from the
    // roster check so the two directions can't be confused in a failure report.
    expect(migratedLabels.every((l) => rosterIds.includes(l))).toBe(true);
  });

  it("never reuses a renamed-away id as a live target", () => {
    // Reviving a retired id would silently inherit the old value's rows.
    for (const legacy of Object.keys(LEGACY_TARGET_IDS)) {
      expect(rosterIds).not.toContain(legacy);
    }
  });

  it("has a LEGACY_TARGET_IDS entry for every rename and no invented ones", () => {
    const renamedAway = ops.filter((o) => o.kind === "rename").map((o) => o.from);
    expect(Object.keys(LEGACY_TARGET_IDS).sort()).toEqual(
      [...new Set(renamedAway)].sort(),
    );
  });
});

describe("enum-mismatch write errors", () => {
  // The exact PostgREST body observed from the hosted project while the
  // migration was unapplied.
  const REAL = {
    code: "22P02",
    details: null,
    hint: null,
    message: 'invalid input value for enum model_target: "gpt_5_6_terra"',
  };

  it("classifies the real PostgREST enum error", () => {
    expect(enumMismatch(REAL)).toEqual({
      enumName: "model_target",
      value: "gpt_5_6_terra",
    });
  });

  it("names the model by its display label instead of leaking the raw error", () => {
    const msg = describeWriteError(REAL, "Couldn't save.");
    expect(msg).toBe(
      "GPT-5.6 Terra isn't available on the server yet — pick another model and try again.",
    );
    expect(msg).not.toContain("invalid input value");
    expect(msg).not.toContain("model_target");
  });

  it("falls back to the raw label when the value has no roster entry", () => {
    // A value only the DB knows (a roster entry that was removed) still needs a
    // sentence, and there is no display label to use.
    expect(
      describeWriteError(
        {
          code: "22P02",
          message: 'invalid input value for enum model_target: "kimi_k2_6"',
        },
        "Couldn't save.",
      ),
    ).toContain("kimi_k2_6");
  });

  it("handles a mismatch on any other enum without naming a model", () => {
    expect(
      describeWriteError(
        {
          code: "22P02",
          message: 'invalid input value for enum enhance_mode: "sharpen"',
        },
        "Couldn't save.",
      ),
    ).toBe("That option isn't available on the server yet — pick another and try again.");
  });

  it("never puts raw Postgres text in front of a user", () => {
    // This assertion used to be the opposite — `toBe(rls.message)`, on the
    // reasoning that "RLS and constraint messages are useful as-is". They are,
    // to an operator reading a log; to a user they are a toast naming a policy.
    // Postgres text carries constraint, column, policy and function names, and
    // docs/runbooks/migrations.md records this passthrough already reaching a
    // user once. The raw text now goes to writeErrorLogLine instead.
    const rls = { code: "42501", message: "new row violates row-level security policy" };
    expect(enumMismatch(rls)).toBeNull();
    const shown = describeWriteError(rls, "Couldn't save.");
    expect(shown).not.toContain("row-level security");
    expect(shown).not.toContain("policy");
    expect(shown).toBe("You don't have access to that.");
    // The operator still gets everything.
    expect(writeErrorLogLine("library", "write", rls)).toContain(rls.message);

    // 22P02 also covers malformed uuid/numeric input — not schema drift, so it
    // must not claim a model is unavailable, and must not echo the value.
    const badUuid = {
      code: "22P02",
      message: 'invalid input syntax for type uuid: "nope"',
    };
    expect(enumMismatch(badUuid)).toBeNull();
    expect(describeWriteError(badUuid, "Couldn't save.")).toBe("Couldn't save.");

    // Unrecognised codes fall back rather than leaking.
    expect(
      describeWriteError(
        { code: "XX000", message: "function public.spend_reserve(...) does not exist" },
        "Couldn't save.",
      ),
    ).toBe("Couldn't save.");

    expect(describeWriteError(null, "Couldn't save.")).toBe("Couldn't save.");
    expect(describeWriteError({ message: null }, "Couldn't save.")).toBe(
      "Couldn't save.",
    );
  });

  it("maps the constraint codes a user can act on", () => {
    expect(describeWriteError({ code: "23505", message: "duplicate key" }, "x")).toBe(
      "That already exists.",
    );
    expect(
      describeWriteError({ code: "23503", message: "violates foreign key" }, "x"),
    ).toContain("no longer there");
    // 23514 is the usage_events non-negative check added in Phase 0.
    expect(
      describeWriteError(
        {
          code: "23514",
          message: 'violates check constraint "usage_events_nonneg_amounts"',
        },
        "x",
      ),
    ).toBe("That value isn't allowed.");
    // …and none of them echo the constraint name.
    for (const code of ["23505", "23503", "23514"]) {
      expect(
        describeWriteError({ code, message: 'constraint "secret_internal_name"' }, "x"),
      ).not.toContain("secret_internal_name");
    }
  });

  it("names schema drift in the server log so an operator can act on it", () => {
    const line = writeErrorLogLine("enhance", "usage ledger write", REAL);
    expect(line).toContain("[enhance]");
    expect(line).toContain("SCHEMA DRIFT");
    expect(line).toContain("gpt_5_6_terra");
    expect(line).toContain("check:db-enum");

    expect(
      writeErrorLogLine("media", "usage ledger write", {
        code: "42501",
        message: "denied",
      }),
    ).toBe("[media] usage ledger write failed: denied");
  });
});
