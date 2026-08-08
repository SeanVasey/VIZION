import { readFileSync, readdirSync } from "node:fs";
import { basename, join, relative } from "node:path";
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

/** Every .ts/.tsx file under `dir`, as ROOT-relative paths. Used by the
 *  containment guard below, which has to be repo-wide to be worth anything —
 *  an invariant asserted only for the files that exist today is an invariant
 *  the next adapter is free to break. */
function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(full);
    return /\.tsx?$/.test(entry.name) ? [relative(ROOT, full)] : [];
  });
}

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
  //
  // DERIVED, not listed. A hardcoded roster asserts the policy over the files
  // that existed the day it was written, and the next adapter is simply not
  // covered — which is the same failure as `google.ts` sitting outside the
  // deadline rollout for five review rounds because it "wasn't shaped like an
  // adapter". A module that wraps a provider stream IS a streaming adapter, so
  // let the code say so: calling withIdleTimeout is the definition.
  const PROVIDER_DIR = join(ROOT, "src", "lib", "providers");
  const streamingSdkFiles = sourceFiles(PROVIDER_DIR)
    .filter((f) => !/idle-timeout\.ts$/.test(f))
    .filter((f) => read(f).includes("withIdleTimeout("))
    .map((f) => basename(f))
    .sort();

  it("derives the streaming roster from the code, and it is not empty", () => {
    // A derived list that silently evaluates to [] would make every assertion
    // below vacuous — the loop would pass by running zero times. Pin the floor
    // and the known members so a broken derivation fails loudly instead.
    expect(streamingSdkFiles).toEqual(
      expect.arrayContaining([
        "anthropic.ts",
        "mistral.ts",
        "openai-compat.ts",
        "openai.ts",
        "xai.ts",
      ]),
    );
    expect(streamingSdkFiles.length).toBeGreaterThanOrEqual(5);
  });

  it("every provider that opens a connection takes a budget first", () => {
    // The companion to the roster above, and the rule google.ts broke: a
    // module does not escape the policy by being shaped differently. Anything
    // in providers/ that constructs an SDK client or issues a raw fetch must
    // derive its bound from the invocation's one wall.
    //
    // vision.ts is the single documented exception — /api/media is a bounded
    // one-shot under its own maxDuration=60 route, with its own constant so a
    // value sized for bounded calls can never again govern streaming ones.
    const opensConnection = sourceFiles(PROVIDER_DIR).filter((f) => {
      const src = read(f);
      return (
        /new (OpenAI|Anthropic)\(/.test(src) || /\bawait fetch\(/.test(src)
      );
    });
    const offenders = opensConnection
      .filter((f) => !/vision\.ts$/.test(f))
      .filter((f) => !read(f).includes("providerBudget("));
    expect(
      offenders,
      "a provider module that opens a connection must bound it via providerBudget()",
    ).toEqual([]);
    // Guard the guard: if the detector stops matching, this says so.
    expect(opensConnection.length).toBeGreaterThanOrEqual(6);
  });

  for (const file of streamingSdkFiles) {
    it(`${file} cuts its SDK timeout from the REMAINING budget, not the constant`, () => {
      // This assertion used to demand `timeout: PROVIDER_TOTAL_MS`, and that
      // is the single most instructive thing about PR #91: the guard test
      // pinned the defect in place as a requirement, so each round of the fix
      // had to fight it. The SDK `timeout` bounds connect-and-headers — time
      // the invocation's one wall is ALREADY counting — so arming it with the
      // full constant handed the header wait its own full-length budget
      // beside the stream's, and the two summed past maxDuration.
      //
      // Assert the property (derived from the wall), never the literal.
      const src = read("src", "lib", "providers", file);
      expect(src).toMatch(/timeout:\s*timeoutMs/);
      expect(src).not.toMatch(/timeout:\s*PROVIDER_TOTAL_MS/);
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

    it(`${file} takes ONE budget from the caller's wall, before the request`, () => {
      // Three properties in one, because they were three separate rounds of
      // the same bug.
      //
      // (a) The wall must come from the caller when offered. The route takes
      //     it at entry so its own preflight -- auth, settings, JSON parse,
      //     reserveSpend -- counts against the same maxDuration the platform
      //     is already measuring. An adapter-local deadline excludes all of
      //     that.
      // (b) The fallback must still be taken BEFORE the request, since most
      //     adapters await create(), which resolves at the response HEADERS.
      //     Otherwise header latency and stream time get separate windows.
      // (c) Both must come from the SAME call, so there is no second place to
      //     forget. providerBudget() resolves the wall and derives the
      //     duration together; an adapter cannot honour one and miss the
      //     other, which is exactly how the SDK timeout survived four rounds.
      const src = read("src", "lib", "providers", file);
      expect(src).toMatch(
        /const \{ deadline, timeoutMs \} = providerBudget\(\s*[^,]+,\s*(opts|req)\.deadline,?\s*\)/,
      );
      expect(src).toMatch(/deadline,/);
      // Ordering is the property, so assert it rather than mere presence.
      const taken = src.indexOf("providerBudget(");
      const used = src.indexOf("withIdleTimeout(");
      expect(taken).toBeGreaterThan(-1);
      expect(taken).toBeLessThan(used);
    });
  }

  it("PROVIDER_TOTAL_MS is read as a duration in exactly one place", () => {
    // THE structural guard, and the reason this class of bug cannot recur.
    //
    // PR #91 took six review rounds because each fix RELOCATED the timer --
    // route preflight, then header wait, then stream body, then the SDK client
    // -- while the constant stayed importable and `PROVIDER_TOTAL_MS` went on
    // type-checking and reading plausibly at every layer below. Any layer that
    // arms its own full-length timer puts two budgets in SERIES; two budgets
    // that each read 285s do not sum to 285s.
    //
    // So the constant is converted to an absolute wall exactly once, in
    // providerDeadline(), and every timer below is cut from remainingMs().
    // A new adapter that reaches for the constant fails here rather than in
    // the seventh round of somebody's review.
    const allowed = new Set([
      join("src", "lib", "providers", "config.ts"), // the declaration
      join("src", "lib", "providers", "idle-timeout.ts"), // providerDeadline()
    ]);
    // IMPORTS, not mere mentions. The constant is not a global, so importing it
    // is the only way to read it — which makes this precise where a bare text
    // scan is not: prose that names it (the route's maxDuration note explains
    // the pairing, and should) is not a second timer, and a guard that cannot
    // tell those apart gets weakened the first time it cries wolf.
    const imports = (src: string) =>
      /import\s*\{[^}]*\bPROVIDER_TOTAL_MS\b[^}]*\}\s*from/s.test(src) ||
      /\bconfig["']\s*\)\s*\.\s*PROVIDER_TOTAL_MS\b/.test(src);
    const offenders = sourceFiles(join(ROOT, "src"))
      .filter((f) => !allowed.has(f))
      .filter((f) => imports(read(f)));
    expect(
      offenders,
      "PROVIDER_TOTAL_MS is a WALL, not a reusable duration — take it via providerBudget()/providerDeadline() and cut timers from remainingMs(deadline)",
    ).toEqual([]);
  });

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

  it("google.ts resets its abort clock on every chunk, on the CALLER's wall", () => {
    // Gemini is a raw fetch with no SDK to wrap, so it carries the same policy
    // by hand: one AbortController, a total backstop, and an idle timer
    // re-armed inside the read loop.
    //
    // Being hand-rolled is precisely why it was the last adapter still arming
    // a fresh 285s total: it did not LOOK like the SDK adapters, so when the
    // route began passing a deadline this file was threaded it and then never
    // read it. "Every adapter except the one shaped differently" is how an
    // invariant survives five review rounds and still fails in production.
    const src = read("src", "lib", "providers", "google.ts");
    expect(src).toContain("PROVIDER_IDLE_MS");
    expect(src).toMatch(
      /const \{ deadline, timeoutMs \} = providerBudget\(\s*"google",\s*opts\.deadline,?\s*\)/,
    );
    // The total is cut from the wall, and the idle timer can never outlast it.
    expect(src).toMatch(/setTimeout\(\s*\(\)\s*=>\s*controller\.abort\(\),\s*timeoutMs\)/);
    expect(src).toMatch(/Math\.min\(PROVIDER_IDLE_MS,\s*remainingMs\(deadline\)\)/);
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
