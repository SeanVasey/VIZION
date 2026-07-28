/**
 * The out-of-band control surface of the stub Supabase, and the single place
 * its port is written down.
 *
 * `playwright.config.ts`, `global-setup.ts` and `auth.ts` all needed the stub's
 * address; two of them hardcoded `54321` independently, so moving it meant
 * finding all three.
 */
export const STUB_PORT = parsePort(process.env.SUPABASE_STUB_PORT);
export const STUB_URL = `http://127.0.0.1:${STUB_PORT}`;

/**
 * Throws rather than letting a bad value through. `Number("nope")` is `NaN`,
 * which formats into `http://127.0.0.1:NaN` and surfaces as a fetch failure
 * several layers away from the typo that caused it — and this module is
 * imported by `playwright.config.ts`, so the throw lands at config load with
 * the offending value in the message.
 */
function parsePort(raw: string | undefined): number {
  if (raw === undefined) return 54321;
  const port = Number(raw);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(
      `SUPABASE_STUB_PORT must be a port number between 1 and 65535, got ${JSON.stringify(raw)}.`,
    );
  }
  return port;
}

/**
 * Wipe the stub back to first-run condition. Call once per run, before any
 * spec — `global-setup.ts` does, and Playwright starts `webServer` plugins
 * before `globalSetup`, so the stub is already listening by then.
 *
 * Without this, `reuseExistingServer` (on for every non-CI run) hands the next
 * run a stub carrying the last one's mutated tables and its whole append-only
 * list of unhandled routes — so a single unsupported request poisons
 * `expectNoUnhandledStubRoutes` in every subsequent clean run until someone
 * thinks to kill the background process. `next build` prerendering against the
 * stub can seed that list too, before a test has run at all.
 */
export async function resetStubState(): Promise<void> {
  const res = await fetch(`${STUB_URL}/__stub/reset`).catch((err: unknown) => {
    throw new Error(
      `Could not reach the stub Supabase at ${STUB_URL} to reset it: ${
        (err as Error).message
      }\nIt is a configured webServer, so by this point it must be listening.`,
    );
  });
  if (!res.ok) {
    throw new Error(`Stub Supabase refused the reset: HTTP ${res.status}`);
  }

  // Trust the STATE, not the 200. `reuseExistingServer` can hand this run a
  // stub process from an older revision — including one predating this fix,
  // whose reset reseeds `tables` and leaves this list untouched. That stub
  // answers `{"ok":true}` and stays poisoned (verified against the parent
  // revision's handler), so a status-code check would wave through the exact
  // cross-run state the reset exists to clear, and the run would fail later in
  // whichever spec called `expectNoUnhandledStubRoutes` first.
  //
  // Reading it back also means a future partial reset fails HERE, naming
  // itself, instead of surfacing as an unrelated spec failure.
  const leftover = await readUnhandledStubRoutes();
  if (leftover.length) {
    throw new Error(
      [
        `The stub Supabase at ${STUB_URL} accepted a reset but is still reporting ${leftover.length} unhandled route(s):`,
        ...leftover.map((entry) => `  ${entry}`),
        "",
        "Most likely it is a leftover process from an older revision, reused via",
        "`reuseExistingServer`, whose reset does not clear this list. Kill it and re-run:",
        `  pkill -f supabase-stub`,
      ].join("\n"),
    );
  }
}

/** Routes the stub was asked for and does not implement. Empty is the pass. */
export async function readUnhandledStubRoutes(): Promise<string[]> {
  const res = await fetch(`${STUB_URL}/__stub/unhandled`);
  const { unhandled } = (await res.json()) as { unhandled: string[] };
  return unhandled;
}
