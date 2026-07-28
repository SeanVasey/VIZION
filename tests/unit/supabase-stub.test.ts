import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { createStubServer } from "../e2e/support/supabase-stub.mjs";

/**
 * The e2e stub Supabase is a stateful server that `playwright.config.ts` runs
 * with `reuseExistingServer` on for every non-CI run. That makes its reset
 * load-bearing, and it was neither complete nor ever called:
 *
 *   - it reseeded `tables` but left `unhandled` — a process-lifetime,
 *     append-only list — so ONE unsupported request made every subsequent
 *     clean run fail `expectNoUnhandledStubRoutes`, curable only by knowing to
 *     kill a background process nobody remembers starting;
 *   - and nothing invoked it, so it read as a safety net while being dead code.
 *
 * These run the real handler (imported, not reimplemented) on an ephemeral
 * port, through the same `stub-control.ts` helpers `global-setup.ts` uses.
 * Both were proven red against the previous `tables = seed()` reset.
 */

let server: Server;
let control: typeof import("../e2e/support/stub-control");
let base: string;
/** Restored in `afterAll` — this file is the only thing that sets it. */
let originalPortEnv: string | undefined;

beforeAll(async () => {
  server = createStubServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as AddressInfo).port;
  base = `http://127.0.0.1:${port}`;
  // `stub-control` reads the port at module load, so it has to be imported
  // after the server has one — which also proves the helper honours
  // SUPABASE_STUB_PORT rather than hardcoding 54321.
  originalPortEnv = process.env.SUPABASE_STUB_PORT;
  process.env.SUPABASE_STUB_PORT = String(port);
  control = await import("../e2e/support/stub-control");
  expect(control.STUB_URL).toBe(base);
});

afterAll(async () => {
  // Vitest isolates test files today, so nothing else would see this. That is a
  // property of the runner's config, not of this file, and it is one setting
  // away from not being true.
  if (originalPortEnv === undefined) delete process.env.SUPABASE_STUB_PORT;
  else process.env.SUPABASE_STUB_PORT = originalPortEnv;
  vi.resetModules();

  await new Promise<void>((resolve, reject) =>
    server.close((err) => (err ? reject(err) : resolve())),
  );
});

const json = async (path: string, init?: RequestInit) => {
  const res = await fetch(`${base}${path}`, init);
  return { status: res.status, body: await res.json() };
};

describe("stub Supabase reset", () => {
  it("clears the unhandled-route list, not just the tables", async () => {
    // The exact poisoning a reused stub used to carry into the next run.
    const miss = await json("/rest/v1/does_not_exist");
    expect(miss.status).toBe(501);
    expect(await control.readUnhandledStubRoutes()).toContain(
      "GET /rest/v1/does_not_exist (unknown table)",
    );

    await control.resetStubState();

    expect(await control.readUnhandledStubRoutes()).toEqual([]);
  });

  it("restores rows a run mutated", async () => {
    const rows = async () => (await json("/rest/v1/prompts")).body as unknown[];
    expect(await rows()).toHaveLength(3);

    await json("/rest/v1/prompts", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: "left behind by an earlier run" }),
    });
    expect(await rows()).toHaveLength(4);

    await control.resetStubState();

    expect(await rows()).toHaveLength(3);
  });

  it("also clears a recorded schema-drift warning", async () => {
    // `assertKnownColumn` writes into the same list from a different path, so
    // a reset that only knew about unhandled ROUTES would still leak this one.
    await json("/rest/v1/prompts?no_such_column=is.null");
    expect(await control.readUnhandledStubRoutes()).toEqual([
      "FILTER on unknown column prompts.no_such_column — fixture is missing it",
    ]);

    await control.resetStubState();

    expect(await control.readUnhandledStubRoutes()).toEqual([]);
  });

  it("is actually invoked by the e2e run, not merely available", async () => {
    // The half of this bug that a behavioural test cannot see: the route was
    // correct-looking and complete-looking for a whole PR while NOTHING called
    // it, so it read as a safety net and was dead code. A source assertion
    // because the caller is a Playwright global-setup hook — importing it here
    // would drag in `@playwright/test` and run its browser-install preflight,
    // which is not what this is checking.
    // Vitest's `import.meta.url` is a Vite module URL, not a file: one.
    const src = await readFile(
      resolve(process.cwd(), "tests/e2e/global-setup.ts"),
      "utf8",
    );
    // `[\s\S]*?` rather than `[^}]*`: both span newlines, so both survive
    // Prettier breaking the import across lines, but only this one says so.
    expect(src).toMatch(
      /import \{[\s\S]*?resetStubState[\s\S]*?\} from "\.\/support\/stub-control"/,
    );
    expect(src).toMatch(/await resetStubState\(\)/);
  });

  it("refuses a nonsense SUPABASE_STUB_PORT rather than building a NaN URL", async () => {
    // `Number("nope")` is NaN, which formats into `http://127.0.0.1:NaN` and
    // resurfaces as a fetch failure several layers from the typo. This module
    // is imported by `playwright.config.ts`, so the throw lands at config load.
    process.env.SUPABASE_STUB_PORT = "not-a-port";
    vi.resetModules();
    await expect(import("../e2e/support/stub-control")).rejects.toThrow(
      /SUPABASE_STUB_PORT must be a port number between 1 and 65535/,
    );

    process.env.SUPABASE_STUB_PORT = String((server.address() as AddressInfo).port);
    vi.resetModules();
  });

  it("reports an unreachable stub as an error, never as a clean reset", async () => {
    // `global-setup.ts` calls this after Playwright has started the stub as a
    // webServer. If it is somehow not there, the run must stop — a silently
    // skipped reset is exactly the state these tests exist to prevent.
    process.env.SUPABASE_STUB_PORT = "1";
    vi.resetModules();
    const stray = await import("../e2e/support/stub-control");
    await expect(stray.resetStubState()).rejects.toThrow(/Could not reach the stub/);

    process.env.SUPABASE_STUB_PORT = String((server.address() as AddressInfo).port);
    vi.resetModules();
  });
});
