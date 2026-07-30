import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { maxEnhanceCost, maxVisionCost } from "@/lib/security/spend";

const root = join(__dirname, "..", "..");

describe("atomic spend migration", () => {
  const sql = readFileSync(
    join(
      root,
      "supabase/migrations/20260730120000_atomic_spend_and_prompt_integrity.sql",
    ),
    "utf8",
  );

  it("serializes admission and accounts for pending reservations", () => {
    expect(sql).toContain("pg_advisory_xact_lock");
    expect(sql).toMatch(/v_today \+ v_pending \+ p_max_cost > p_cap/);
    expect(sql).toContain("status = 'pending'");
  });

  it("keeps privileged RPCs authenticated and on a fixed search path", () => {
    for (const fn of ["spend_reserve", "spend_settle", "spend_release"]) {
      expect(sql).toContain(`revoke execute on function public.${fn} from anon, public`);
      expect(sql).toContain(`grant execute on function public.${fn} to authenticated`);
    }
    expect(sql.match(/set search_path = public/g)?.length).toBeGreaterThanOrEqual(6);
  });

  it("makes library saves transactional and guards version parentage", () => {
    expect(sql).toContain("library_save_prompt");
    expect(sql).toContain("library_add_version");
    expect(sql).toContain("version_not_owned_by_prompt");
  });
});

describe("reservation ceilings", () => {
  it("reserves more for expensive/deep requests", () => {
    expect(maxEnhanceCost("fable_5", 20_000, "max")).toBeGreaterThan(
      maxEnhanceCost("gpt_5_6_terra", 20_000),
    );
    expect(maxEnhanceCost("opus_5", 20_000, "max")).toBeGreaterThan(
      maxEnhanceCost("opus_5", 20_000, "low"),
    );
  });

  it("uses a conservative bounded reservation for vision", () => {
    expect(maxVisionCost("fable_5")).toBeGreaterThan(maxVisionCost("gpt_5_6_terra"));
    expect(maxVisionCost("fable_5")).toBeGreaterThan(0);
  });
});

describe("service-worker privacy", () => {
  it("does not runtime-cache navigations", () => {
    const source = readFileSync(join(root, "src/lib/pwa/sw-src.js"), "utf8");
    const matcher = source.slice(
      source.indexOf("const isShellAsset"),
      source.indexOf("registerRoute"),
    );
    expect(matcher).not.toContain('request.mode === "navigate"');
    expect(source).toContain('const APP_SHELL_URL = "/offline.html"');
  });
});
