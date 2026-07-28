/**
 * The out-of-band control surface of the stub Supabase, and the single place
 * its port is written down.
 *
 * `playwright.config.ts`, `global-setup.ts` and `auth.ts` all needed the stub's
 * address; two of them hardcoded `54321` independently, so moving it meant
 * finding all three.
 */
export const STUB_PORT = Number(process.env.SUPABASE_STUB_PORT ?? 54321);
export const STUB_URL = `http://127.0.0.1:${STUB_PORT}`;

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
}

/** Routes the stub was asked for and does not implement. Empty is the pass. */
export async function readUnhandledStubRoutes(): Promise<string[]> {
  const res = await fetch(`${STUB_URL}/__stub/unhandled`);
  const { unhandled } = (await res.json()) as { unhandled: string[] };
  return unhandled;
}
