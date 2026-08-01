import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { PROVIDER_KEY_ENV } from "@/lib/providers/config";

/**
 * Source contracts over the provider layer:
 *
 * 1. PRV-004 — every adapter's hardcoded key-env name must equal
 *    PROVIDER_KEY_ENV for its provider. The route's pre-stream 503 gate
 *    (isProviderConfigured) and the adapter's own key check read these two
 *    places independently; drift reproduces the mid-stream
 *    ProviderNotConfiguredError the gate exists to prevent.
 * 2. PRV-002 — every SDK client construction and raw fetch is bounded by the
 *    uniform connection policy so a provider hang can't outlive maxDuration
 *    and strand the spend hold.
 * 3. PRI-001 — the enhance route diffs through boundedDiffWords only; the
 *    unbounded O(n·m) LCS on the server event loop is what OOM'd the budget.
 */
const ROOT = join(__dirname, "..", "..");
const read = (...p: string[]) => readFileSync(join(ROOT, ...p), "utf8");

describe("provider key env correspondence (PRV-004)", () => {
  const perFile: Record<string, string[]> = {
    "anthropic.ts": [PROVIDER_KEY_ENV.anthropic],
    "openai.ts": [PROVIDER_KEY_ENV.openai],
    "google.ts": [PROVIDER_KEY_ENV.google],
    "mistral.ts": [PROVIDER_KEY_ENV.mistral],
    "xai.ts": [PROVIDER_KEY_ENV.xai],
  };
  for (const [file, envs] of Object.entries(perFile)) {
    it(`${file} reads exactly its PROVIDER_KEY_ENV name`, () => {
      const src = read("src", "lib", "providers", file);
      for (const env of envs) {
        expect(src).toContain(`process.env.${env}`);
      }
    });
  }

  it("openai-compat.ts declares each compat provider's PROVIDER_KEY_ENV name", () => {
    const src = read("src", "lib", "providers", "openai-compat.ts");
    for (const provider of [
      "deepseek",
      "meta",
      "minimax",
      "moonshot",
      "perplexity",
      "qwen",
      "zai",
    ] as const) {
      const env = PROVIDER_KEY_ENV[provider];
      expect(src, `${provider} → ${env}`).toMatch(
        new RegExp(`keyEnv:\\s*"${env}"`),
      );
    }
  });
});

describe("uniform connection policy (PRV-002)", () => {
  const sdkFiles = [
    "anthropic.ts",
    "openai.ts",
    "mistral.ts",
    "xai.ts",
    "openai-compat.ts",
    "vision.ts",
  ];
  for (const file of sdkFiles) {
    it(`${file} constructs clients with the policy timeout + retries`, () => {
      const src = read("src", "lib", "providers", file);
      expect(src).toMatch(/timeout:\s*PROVIDER_TIMEOUT_MS/);
      expect(src).toMatch(/maxRetries:\s*PROVIDER_MAX_RETRIES/);
    });
  }

  for (const file of ["google.ts", "vision.ts"]) {
    it(`${file}'s raw fetches carry the policy AbortSignal`, () => {
      const src = read("src", "lib", "providers", file);
      expect(src).toMatch(/AbortSignal\.timeout\(PROVIDER_TIMEOUT_MS\)/);
    });
  }
});

describe("server diff is bounded (PRI-001)", () => {
  it("the enhance route imports boundedDiffWords and never the unbounded diff", () => {
    const src = read("src", "app", "api", "enhance", "route.ts");
    expect(src).toContain("boundedDiffWords");
    // No bare diffWords call: `boundedDiffWords(` is the only permitted form.
    expect(src).not.toMatch(/[^d]diffWords\(/);
  });
});
