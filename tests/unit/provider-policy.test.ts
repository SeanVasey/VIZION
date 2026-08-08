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
  // The STREAMING enhance adapters. Their SDK `timeout` bounds only
  // connect-and-headers (it is cleared when fetch() settles), so both real
  // budgets — idle and the absolute total — are enforced in application code.
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
      // Every streaming adapter must route its loop through withIdleTimeout:
      // once the body streams the SDK bounds nothing, so a stream left
      // unwrapped has neither an idle limit nor a total one.
      const src = read("src", "lib", "providers", file);
      expect(src).toContain("withIdleTimeout");
      expect(src).toMatch(/for await \([^)]*of withIdleTimeout\(/);
    });

    it(`${file} hands withIdleTimeout the SDK's own abort handle`, () => {
      // Not optional, and not cosmetic. Both SDKs implement
      // [Symbol.asyncIterator] as an async generator, and the protocol QUEUES
      // return() behind an already-pending next(). At idle-out a read is
      // always in flight, so without an explicit abort the cleanup cannot run
      // until the upstream settles or the 285s deadline fires -- which would
      // make the idle timeout decorative and leave the route almost no window
      // to settle its spend hold. (Codex review, PR #91.)
      const src = read("src", "lib", "providers", file);
      expect(src).toMatch(/cancel:\s*\(\)\s*=>\s*\w+\.(controller\.)?abort\(\)/);
    });

    it(`${file} prefers the CALLER's wall, and takes one before the request`, () => {
      // Two properties in one, because they were two separate bugs.
      //
      // (a) The wall must come from the caller when offered. The route takes
      //     it at entry so its own preflight -- auth, settings, JSON parse,
      //     reserveSpend -- counts against the same maxDuration the platform
      //     is already measuring. An adapter-local deadline excludes all of
      //     that.
      // (b) The fallback must still be taken BEFORE the request, since most
      //     adapters await create(), which resolves at the response HEADERS.
      //     Otherwise header latency and stream time get separate windows.
      const src = read("src", "lib", "providers", file);
      expect(src).toMatch(/(opts|req)\.deadline \?\? providerDeadline\(\)/);
      expect(src).toMatch(/deadline,/);
      // Ordering is the property, so assert it rather than mere presence.
      const taken = src.indexOf("providerDeadline()");
      const used = src.indexOf("withIdleTimeout(");
      expect(taken).toBeGreaterThan(-1);
      expect(taken).toBeLessThan(used);
    });
  }

  it("the enhance route takes the wall at entry, before any preflight", () => {
    // maxDuration starts when the platform invokes the handler, so the budget
    // has to start there too. A slow preflight plus a full-length stream can
    // otherwise overrun the window and skip the spend-settling finally.
    const src = read("src", "app", "api", "enhance", "route.ts");
    const taken = src.indexOf("providerDeadline()");
    expect(taken).toBeGreaterThan(-1);
    // Before the first await of any preflight work, and before the stream.
    for (const later of ["createClient(", "reserveSpend(", "enhanceStream("]) {
      expect(taken, `providerDeadline() must precede ${later}`).toBeLessThan(
        src.indexOf(later),
      );
    }
    expect(src).toMatch(/deadline,/);
  });

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
