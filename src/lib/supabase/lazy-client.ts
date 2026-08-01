/**
 * Lazily load the browser Supabase client so `@supabase/ssr` +
 * `@supabase/supabase-js` (~62 kB gz) stay OUT of the first-load bundle of any
 * route that only touches Supabase on interaction (PERF-001 / Q14).
 *
 * Importing THIS module is bundle-safe: it has no static import of the client
 * or of `@supabase/*` — the heavy code sits behind the dynamic `import()` below,
 * so the bundler splits it into an async chunk. The interaction-only consumers
 * (AttachmentTray, SettingsPanel, MediaManager) therefore no longer drag
 * supabase-js into `/enhance` and `/profile` first loads.
 *
 * Every call site already runs inside an async handler, so the dynamic import
 * adds no synchronous cost, and the module resolves once then stays cached.
 */
export async function loadBrowserClient() {
  const { createClient } = await import("@/lib/supabase/client");
  return createClient();
}

/** The browser client's type, without importing `@supabase/*` as a value. */
export type BrowserClient = Awaited<ReturnType<typeof loadBrowserClient>>;
