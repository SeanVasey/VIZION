import { readdirSync, readFileSync, existsSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The migration directory's own contract.
 *
 * For six weeks `supabase/migrations/` could not rebuild the database: the
 * P2–P5 base schema had been applied straight to the hosted project and lived
 * only in its ledger. Nothing caught it, because every later migration applies
 * fine on top of a schema that is already there — the gap is invisible until
 * the day someone needs a fresh environment.
 *
 * `npm run db:verify` is the real proof (it replays the whole directory
 * against a throwaway Postgres). These are the parts that can be checked
 * without a server, and the reference-integrity one is what stops a rename
 * from quietly orphaning the comments that explain the schema.
 */

const ROOT = join(__dirname, "..", "..");
const MIGRATIONS = join(ROOT, "supabase", "migrations");
const FILES = readdirSync(MIGRATIONS).filter((f) => f.endsWith(".sql"));

describe("every migration is named the way the CLI orders them", () => {
  it("uses a 14-digit timestamp and a snake_case slug", () => {
    // The Supabase CLI matches the leading digits against its ledger. A file
    // it cannot parse is not "skipped" — it is applied again.
    const bad = FILES.filter((f) => !/^\d{14}_[a-z0-9_]+\.sql$/.test(f));
    expect(bad).toEqual([]);
  });

  it("has no two migrations claiming the same version", () => {
    const versions = FILES.map((f) => f.slice(0, 14));
    expect(versions.length).toBe(new Set(versions).size);
  });

  it("orders identically whether sorted as text or as numbers", () => {
    // Everything downstream — the CLI, the enum replay, db:verify — assumes
    // lexical filename order IS applied order.
    const byText = [...FILES].sort();
    const byNumber = [...FILES].sort(
      (a, b) => Number(a.slice(0, 14)) - Number(b.slice(0, 14)),
    );
    expect(byText).toEqual(byNumber);
  });
});

describe("the directory can build the database from nothing", () => {
  const all = FILES.sort()
    .map((f) => readFileSync(join(MIGRATIONS, f), "utf8"))
    .join("\n");

  it("creates every table the app reads, rather than assuming it exists", () => {
    // Each of these was hosted-only before the baseline was recovered. A
    // migration directory that starts at `alter table public.prompts` is a
    // patch set, not a schema.
    for (const table of [
      "profiles",
      "oauth_identities",
      "usage_events",
      "prompts",
      "prompt_versions",
      "activity_events",
      "media_assets",
    ]) {
      expect(all, `no create table for public.${table}`).toMatch(
        new RegExp(`create table (?:if not exists )?public\\.${table}\\b`, "i"),
      );
    }
  });

  it("creates every enum before anything alters it", () => {
    for (const type of [
      "theme",
      "model_target",
      "auth_method",
      "enhance_mode",
      "media_kind",
    ]) {
      const created = new RegExp(`create type public\\.${type} as enum`, "i").exec(all);
      expect(created, `no create type for public.${type}`).not.toBeNull();
      const altered = new RegExp(`alter type (?:public\\.)?${type}\\b`, "i").exec(all);
      if (altered) expect(created!.index).toBeLessThan(altered.index);
    }
  });

  it("declares RLS on every table it creates", () => {
    // Guardrail §6: never ship a table without a policy. Checked here because
    // the moment a table is created outside these files, it stops being checked
    // anywhere at all.
    const created = [
      ...all.matchAll(/create table (?:if not exists )?public\.([a-z_]+)/gi),
    ].map((m) => m[1]!);
    expect(created.length).toBeGreaterThan(0);
    for (const table of created) {
      expect(all, `public.${table} has no RLS`).toMatch(
        new RegExp(`alter table public\\.${table} enable row level security`, "i"),
      );
    }
  });
});

describe("the schema fingerprint covers what the baseline actually creates", () => {
  // A comparison query is only as good as its WHERE clause, and a narrowed one
  // fails silently: both sides agree, on less. The first cut of this filtered
  // policies to `public` — which excluded all seven policies on
  // storage.objects, the ones that scope avatar and media uploads to their
  // owner — and inner-joined pg_roles for EXECUTE grants, which dropped PUBLIC
  // (grantee OID 0 has no role row). Nine access-control facts, invisible.
  const SQL = readFileSync(join(ROOT, "scripts", "pg-introspect.sql"), "utf8");

  it("compares storage policies, not just public ones", () => {
    expect(SQL).toMatch(
      /pg_policies\s+where\s+schemaname\s+in\s*\(\s*'public',\s*'storage'\s*\)/i,
    );
  });

  it("compares bucket configuration, which is where public-vs-private lives", () => {
    expect(SQL).toMatch(/from storage\.buckets/i);
  });

  it("counts PUBLIC among the EXECUTE grantees", () => {
    // `revoke execute … from … public` is a guardrail on SECURITY DEFINER
    // routines; a fingerprint that cannot see PUBLIC cannot verify it.
    expect(SQL).toMatch(/left join pg_roles/i);
    expect(SQL).toContain("coalesce(r.rolname, 'PUBLIC')");
  });

  it("still creates the storage policies it claims to compare", () => {
    const all = FILES.sort()
      .map((f) => readFileSync(join(MIGRATIONS, f), "utf8"))
      .join("\n");
    for (const policy of [
      "avatars_owner_insert",
      "avatars_owner_update",
      "avatars_owner_delete",
      "media_obj_select_own",
      "media_obj_insert_own",
      "media_obj_delete_own",
    ]) {
      expect(all, `no policy ${policy} on storage.objects`).toContain(policy);
    }
  });
});

describe("nothing points at a migration that no longer exists", () => {
  it("resolves every migration filename cited in code, scripts and runbooks", () => {
    // The filenames carry the reasoning: `spend.ts` explains the cap by
    // pointing at the migration that implements it. When the directory was
    // renamed to match the hosted ledger, five of those citations went stale —
    // silently, because a comment cannot fail to compile. CHANGELOG and
    // docs/audits are excluded on purpose: they are dated records of what the
    // files were called at the time, not live references.
    const roots = ["src", "scripts", "tests", "docs/runbooks"];
    const cited = new Set<string>();

    const walk = (dir: string) => {
      for (const entry of readdirSync(join(ROOT, dir))) {
        const rel = `${dir}/${entry}`;
        if (statSync(join(ROOT, rel)).isDirectory()) walk(rel);
        else if (/\.(tsx?|mjs|md)$/.test(entry)) {
          for (const m of readFileSync(join(ROOT, rel), "utf8").matchAll(
            /\b\d{14}_[a-z0-9_]+\.sql\b/g,
          )) {
            cited.add(m[0]);
          }
        }
      }
    };
    for (const r of roots) walk(r);

    expect(cited.size).toBeGreaterThan(0);
    const missing = [...cited].filter((f) => !existsSync(join(MIGRATIONS, f)));
    expect(missing).toEqual([]);
  });
});
