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
  // The STREAMING enhance adapters. Their SDK `timeout` is a whole-request
  // deadline that covers the body read, so it is the total backstop only —
  // the limit that may actually fire on a healthy run is the idle one.
  const streamingSdkFiles = [
    "anthropic.ts",
    "openai.ts",
    "mistral.ts",
    "xai.ts",
    "openai-compat.ts",
  ];
  for (const file of streamingSdkFiles) {
    it(`${file} constructs clients with the total backstop + retries`, () => {
      const src = read("src", "lib", "providers", file);
      expect(src).toMatch(/timeout:\s*PROVIDER_TOTAL_MS/);
      expect(src).toMatch(/maxRetries:\s*PROVIDER_MAX_RETRIES/);
    });

    it(`${file} bounds its stream on SILENCE, not elapsed time`, () => {
      // The regression this pins: a single whole-request deadline killed
      // healthy long generations at 55s — roughly 2,000-4,000 output tokens
      // against a 16,000-64,000 max_tokens — and the run was still billed.
      // Every streaming adapter must route its loop through withIdleTimeout.
      const src = read("src", "lib", "providers", file);
      expect(src).toContain("withIdleTimeout");
      expect(src).toMatch(/for await \([^)]*of withIdleTimeout\(/);
    });
  }

  it("google.ts resets its abort clock on every chunk", () => {
    // Gemini is a raw fetch with no SDK to wrap, so it carries the same
    // policy by hand: one AbortController, a total backstop, and an idle
    // timer re-armed inside the read loop.
    const src = read("src", "lib", "providers", "google.ts");
    expect(src).toContain("PROVIDER_TOTAL_MS");
    expect(src).toContain("PROVIDER_IDLE_MS");
    expect(src).toMatch(/controller\.abort\(\)/);
    // Re-armed AFTER a successful read — an idle timer set once is just a
    // total deadline wearing a different name.
    expect(src).toMatch(/await reader\.read\(\);[\s\S]{0,200}?armIdle\(\)/);
  });

  it("vision.ts keeps a flat deadline, because /api/media is bounded", () => {
    // Deliberately NOT the streaming policy: one-shot analysis under a
    // maxDuration=60 route, where a whole-request deadline is correct. It has
    // its own constant so a value sized for bounded calls can never again end
    // up governing unbounded streaming ones.
    const src = read("src", "lib", "providers", "vision.ts");
    expect(src).toMatch(/timeout:\s*MEDIA_TIMEOUT_MS/);
    expect(src).toMatch(/maxRetries:\s*PROVIDER_MAX_RETRIES/);
    expect(src).toMatch(/AbortSignal\.timeout\(MEDIA_TIMEOUT_MS\)/);
  });

  it("the enhance route's window stays above the adapters' total backstop", () => {
    // These are a PAIR. If maxDuration ever drops below PROVIDER_TOTAL_MS the
    // platform kills the function first, skipping the finally-block that
    // settles the spend hold — the exact leak PRV-002 exists to prevent.
    const route = read("src", "app", "api", "enhance", "route.ts");
    const config = read("src", "lib", "providers", "config.ts");
    const maxDuration = Number(/maxDuration\s*=\s*(\d+)/.exec(route)?.[1]);
    const total = Number(
      /PROVIDER_TOTAL_MS"?,\s*([\d_]+)/.exec(config)?.[1]?.replace(/_/g, ""),
    );
    expect(Number.isFinite(maxDuration)).toBe(true);
    expect(Number.isFinite(total)).toBe(true);
    expect(total).toBeLessThan(maxDuration * 1000);
  });
});

describe("server diff is bounded (PRI-001)", () => {
  it("the enhance route imports boundedDiffWords and never the unbounded diff", () => {
    const src = read("src", "app", "api", "enhance", "route.ts");
    expect(src).toContain("boundedDiffWords");
    // No bare diffWords call: `boundedDiffWords(` is the only permitted form.
    expect(src).not.toMatch(/[^d]diffWords\(/);
  });
});
