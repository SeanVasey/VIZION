/**
 * A stub Supabase, for e2e only.
 *
 * WHY THIS EXISTS. Every e2e spec in this repo could only ever reach
 * `/sign-in`, because middleware bounces everything else to the gate. The
 * result was that the actual app — the bottom nav, the library, the composer,
 * every `loading.tsx` — had no end-to-end coverage at all, and tests that
 * wanted it had to synthesise markup and assert against the stylesheet instead
 * of the running product.
 *
 * WHY NOT A TEST-ONLY AUTH BYPASS. CLAUDE.md §6 is explicit: Supabase Auth
 * only, RLS on every table. An `if (process.env.E2E) skipAuth()` branch in
 * `src/` is a production auth hole one config mistake away from being real, and
 * it would mean the e2e suite verifies a code path users never execute. Nothing
 * here touches `src/`. The app is pointed at this server purely through
 * `NEXT_PUBLIC_SUPABASE_URL`, the same way `playwright.config.ts` already flips
 * `VIZION_HTTP_ORIGIN` — so the specs drive the *real* middleware, the real
 * `@supabase/ssr` clients, and the real sign-in form.
 *
 * WHAT IT IS NOT. Not a Supabase emulator, and not a place to encode business
 * rules. It implements the narrow slice the authed screens actually touch: the
 * password grant, token refresh, `GET /auth/v1/user`, and enough PostgREST to
 * serve reads from `profiles` / `prompts` / `prompt_versions` /
 * `activity_events` / `collections` / `media_assets` / `usage_events`. **It does not implement RLS.** It answers
 * as the owner, so a spec passing here says nothing about row-level security —
 * that stays the database's job and the migrations' tests. Anything it does not
 * understand returns 501 and is logged, so a silent empty array can never be
 * mistaken for a passing assertion.
 */

import { createServer } from "node:http";
import { pathToFileURL } from "node:url";

const PORT = Number(process.env.SUPABASE_STUB_PORT ?? 54321);

/* ---------------------------------------------------------------- fixtures */

const E2E_USER = {
  id: "00000000-0000-4000-8000-000000000001",
  email: "e2e@vasey.test",
  password: "e2e-password-1234",
};

const NOW = "2026-07-28T12:00:00.000Z";

/** Deterministic ids so specs can assert on them by name. */
const PROMPT_IDS = [
  "11111111-1111-4111-8111-111111111111",
  "22222222-2222-4222-8222-222222222222",
  "33333333-3333-4333-8333-333333333333",
];

function seed() {
  return {
    profiles: [
      {
        user_id: E2E_USER.id,
        email: E2E_USER.email,
        display_name: "E2E Tester",
        avatar_url: null,
        auth_method: "password",
        // Both true, or the (app) layout redirects to /set-password and every
        // authed spec lands on the onboarding gate instead of the app.
        password_set: true,
        theme: "dark",
        default_model: "opus_5",
        reduced_effects: false,
        created_at: NOW,
        updated_at: NOW,
      },
    ],
    // Column names mirror `Database["public"]["Tables"]["prompts"]["Row"]`
    // EXACTLY. They have to: `queryLibraryPage` filters on
    // `.is("archived_at", null)`, and a row missing that column is `undefined`,
    // which is not `null`, so every card silently vanishes and the screen
    // renders "Nothing saved yet" — a green-looking empty-state assertion over
    // a fixture bug. `assertKnownColumn` below now makes that loud instead.
    prompts: PROMPT_IDS.map((id, i) => ({
      id,
      user_id: E2E_USER.id,
      title: `E2E prompt ${i + 1}`,
      target_model: ["opus_5", "sonnet_5", "gpt_5_6_sol"][i],
      tags: i === 0 ? ["e2e", "fixture"] : [],
      favorite: i === 0,
      archived_at: null,
      deleted_at: null,
      preview: `Preview text for E2E prompt ${i + 1}.`,
      current_mode: "polish",
      collection_id: null,
      current_ver: null,
      created_at: NOW,
      // Distinct, descending, so the default `updated_at desc` sort is
      // deterministic rather than incidental.
      updated_at: `2026-07-2${8 - i}T12:00:00.000Z`,
      // The embedded aggregate from `prompt_versions!prompt_id(count)`.
      prompt_versions: [{ count: i + 1 }],
    })),
    prompt_versions: [],
    // Present-but-empty is deliberate for these three: the screens query them,
    // and an unknown table returns 501 (loud) while an empty table returns []
    // (the honest answer for a fresh account).
    media_assets: [],
    usage_events: [],
    activity_events: [
      {
        id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        user_id: E2E_USER.id,
        type: "created",
        meta: { title: "E2E prompt 1" },
        prompt_id: PROMPT_IDS[0],
        created_at: NOW,
      },
    ],
    collections: [],
    // Seeded empty: the Drafts view's default state is "no drafts", and the
    // specs that need a draft create one through the UI (the FAB's Save
    // path), which is the behaviour worth covering anyway.
    drafts: [],
    // Owner-console flags (2026-08). The authed layout and the sign-in page
    // SELECT this on every request; defaults mirror the migration so the
    // authed specs see an open app with the shipped accent strength.
    app_settings: [
      {
        id: 1,
        owner_user_id: null,
        open_access: true,
        dev_accent_strength: 26,
        updated_at: NOW,
      },
    ],
  };
}

let tables = seed();

/**
 * Every piece of mutable state this process owns, back to first-run condition.
 *
 * BOTH halves matter, and the second is the one that bit us. `tables` is
 * mutated by any POST/PATCH/DELETE the app makes, and `unhandled` (below) is
 * append-only for the life of the process. With `reuseExistingServer` on —
 * which is every local run — a stub left over from an earlier run keeps both,
 * so one unsupported request an hour ago fails `expectNoUnhandledStubRoutes`
 * in every clean run afterwards, and the only cure is knowing to kill a
 * background process nobody remembers starting. `next build` prerendering
 * against this stub can leave entries here too, before a single test runs.
 *
 * `tests/e2e/global-setup.ts` calls this once per run. Deliberately not
 * per-test: `fullyParallel` workers share this one process, so a mid-run reset
 * would wipe another worker's state underneath it.
 */
/**
 * Monotonic id source for inserted rows.
 *
 * NOT `tables[table].length + 1`, which is what this used to be. `fullyParallel`
 * runs every project over the same stub process, so two workers inserting into
 * the same table concurrently both read the same length and both mint the same
 * id — after which an id-scoped DELETE removes BOTH rows and a `.single()` read
 * can return the other worker's row. No spec inserted rows from two projects at
 * once until the drafts specs did, which is why a stub that had been correct in
 * practice for months was quietly wrong.
 *
 * Shared across tables on purpose: uniqueness is what matters, not density.
 */
let insertSeq = 0;

function resetState() {
  tables = seed();
  unhandled.length = 0;
  insertSeq = 0;
}

/* --------------------------------------------------------------------- jwt */

function b64url(obj) {
  return Buffer.from(JSON.stringify(obj))
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

/**
 * A structurally valid JWT. supabase-js decodes the payload to read `exp` and
 * schedule refresh; it does not verify the signature client-side, so a fixed
 * placeholder is enough and no secret has to exist anywhere in this repo.
 */
function mintToken(ttlSeconds = 3600) {
  const iat = Math.floor(Date.now() / 1000);
  return [
    b64url({ alg: "HS256", typ: "JWT" }),
    b64url({
      sub: E2E_USER.id,
      email: E2E_USER.email,
      aud: "authenticated",
      role: "authenticated",
      iat,
      exp: iat + ttlSeconds,
      app_metadata: { provider: "email" },
      user_metadata: {},
    }),
    "e2e-stub-not-a-real-signature",
  ].join(".");
}

function userPayload() {
  return {
    id: E2E_USER.id,
    aud: "authenticated",
    role: "authenticated",
    email: E2E_USER.email,
    email_confirmed_at: NOW,
    phone: "",
    confirmed_at: NOW,
    last_sign_in_at: NOW,
    app_metadata: { provider: "email", providers: ["email"] },
    user_metadata: {},
    identities: [],
    created_at: NOW,
    updated_at: NOW,
    is_anonymous: false,
    new_email: null,
  };
}

function sessionPayload() {
  return {
    access_token: mintToken(),
    token_type: "bearer",
    expires_in: 3600,
    expires_at: Math.floor(Date.now() / 1000) + 3600,
    refresh_token: "e2e-refresh-token",
    user: userPayload(),
  };
}

/* -------------------------------------------------------------- postgrest */

/** `col=eq.value` → [col, value]. Only the operators the app actually uses. */
const SUPPORTED_OPS = new Set(["eq", "is", "in", "neq", "gte", "lte", "gt", "lt"]);

/**
 * A filter on a column no fixture row has is schema drift, and it fails in the
 * most misleading way available: `undefined !== null`, so `.is("archived_at",
 * null)` quietly drops every row and the screen renders its empty state. A
 * spec asserting that empty state then passes for entirely the wrong reason.
 * Recorded like an unhandled route so `expectNoUnhandledStubRoutes` fails.
 */
function assertKnownColumn(table, rows, key) {
  if (!rows.length) return;
  if (!(key in rows[0])) {
    const msg = `FILTER on unknown column ${table}.${key} — fixture is missing it`;
    if (!unhandled.includes(msg)) unhandled.push(msg);
    console.warn(`[supabase-stub] ${msg}`);
  }
}

function applyFilters(rows, params, table = "?") {
  let out = rows;
  for (const [key, raw] of params) {
    if (["select", "order", "limit", "offset", "columns", "on_conflict"].includes(key)) {
      continue;
    }
    const [op, ...rest] = raw.split(".");
    if (!SUPPORTED_OPS.has(op)) continue;
    assertKnownColumn(table, rows, key);
    const value = rest.join(".");
    out = out.filter((row) => {
      const cell = row[key];
      switch (op) {
        case "eq":
          return String(cell) === value;
        case "neq":
          return String(cell) !== value;
        case "is":
          return value === "null" ? cell === null : String(cell) === value;
        case "in": {
          const set = value
            .replace(/^\(|\)$/g, "")
            .split(",")
            .map((v) => v.replace(/^"|"$/g, ""));
          return set.includes(String(cell));
        }
        case "gt":
          return String(cell) > value;
        case "gte":
          return String(cell) >= value;
        case "lt":
          return String(cell) < value;
        case "lte":
          return String(cell) <= value;
        default:
          return true;
      }
    });
  }
  return out;
}

function applyOrder(rows, params) {
  const order = params.get("order");
  if (!order) return rows;
  const [col, ...mods] = order.split(".");
  const desc = mods.includes("desc");
  return [...rows].sort((a, b) => {
    const x = a[col];
    const y = b[col];
    if (x === y) return 0;
    return (x > y ? 1 : -1) * (desc ? -1 : 1);
  });
}

/* ------------------------------------------------------------------ server */

/** Every request, so an unhandled route is visible rather than a silent []. */
const unhandled = [];

function send(res, status, body, extraHeaders = {}) {
  const payload = body === undefined ? "" : JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json",
    // The browser client calls this origin directly from the app's page.
    "access-control-allow-origin": "*",
    "access-control-allow-headers": "*",
    "access-control-allow-methods": "GET,POST,PATCH,DELETE,OPTIONS",
    "access-control-expose-headers": "content-range",
    ...extraHeaders,
  });
  res.end(payload);
}

async function readBody(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  if (!chunks.length) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString());
  } catch {
    return {};
  }
}

/**
 * Exported so a unit test can drive the real handler on an ephemeral port
 * instead of asserting against a second, drifting copy of these rules.
 */
export function createStubServer() {
  return createServer(handleRequest);
}

async function handleRequest(req, res) {
  const url = new URL(req.url, `http://127.0.0.1:${PORT}`);
  const { pathname, searchParams } = url;

  if (req.method === "OPTIONS") return send(res, 204);

  // --- test control -------------------------------------------------------
  if (pathname === "/__stub/reset") {
    resetState();
    return send(res, 200, { ok: true });
  }
  if (pathname === "/__stub/unhandled") {
    return send(res, 200, { unhandled });
  }

  // --- auth ---------------------------------------------------------------
  if (pathname === "/auth/v1/token") {
    const grant = searchParams.get("grant_type");
    const body = await readBody(req);
    if (grant === "password") {
      if (body.email !== E2E_USER.email || body.password !== E2E_USER.password) {
        return send(res, 400, {
          error: "invalid_grant",
          error_description: "Invalid login credentials",
        });
      }
      return send(res, 200, sessionPayload());
    }
    if (grant === "refresh_token") return send(res, 200, sessionPayload());
    return send(res, 400, { error: "unsupported_grant_type" });
  }

  if (pathname === "/auth/v1/user") {
    const auth = req.headers.authorization ?? "";
    // Mirrors the real endpoint: no bearer → 401. This is what makes the
    // "signed out is bounced to the gate" specs meaningful rather than
    // accidental.
    if (!auth.startsWith("Bearer ") || auth.endsWith("undefined")) {
      return send(res, 401, { message: "invalid claim: missing sub claim" });
    }
    if (req.method === "PUT") {
      return send(res, 200, userPayload());
    }
    return send(res, 200, userPayload());
  }

  if (pathname === "/auth/v1/logout") return send(res, 204);
  if (pathname === "/auth/v1/settings") {
    return send(res, 200, {
      external: {},
      disable_signup: false,
      mailer_autoconfirm: true,
    });
  }
  if (pathname === "/auth/v1/otp" || pathname === "/auth/v1/magiclink") {
    return send(res, 200, {});
  }

  // --- postgrest ----------------------------------------------------------
  const rest = pathname.match(/^\/rest\/v1\/([a-z_]+)$/);
  if (rest) {
    const table = rest[1];
    if (!(table in tables)) {
      unhandled.push(`${req.method} ${pathname} (unknown table)`);
      return send(res, 501, { message: `stub: unknown table ${table}` });
    }
    const wantsSingle = (req.headers.accept ?? "").includes("vnd.pgrst.object");

    if (req.method === "GET") {
      let rows = applyOrder(
        applyFilters(tables[table], searchParams, table),
        searchParams,
      );
      const limit = searchParams.get("limit");
      if (limit) rows = rows.slice(0, Number(limit));
      if (wantsSingle) {
        if (!rows.length) {
          // PostgREST's own shape for .single()/.maybeSingle() with no row.
          return send(res, 406, {
            code: "PGRST116",
            message: "JSON object requested, multiple (or no) rows returned",
          });
        }
        return send(res, 200, rows[0]);
      }
      return send(res, 200, rows, {
        "content-range": `0-${Math.max(rows.length - 1, 0)}/${rows.length}`,
      });
    }

    if (req.method === "PATCH") {
      const body = await readBody(req);
      const matched = applyFilters(tables[table], searchParams, table);
      for (const row of matched) Object.assign(row, body);
      return send(res, 200, wantsSingle ? (matched[0] ?? null) : matched);
    }

    if (req.method === "POST") {
      const body = await readBody(req);
      const inserted = (Array.isArray(body) ? body : [body]).map((row) => ({
        id: `stub-${++insertSeq}`,
        created_at: NOW,
        updated_at: NOW,
        ...row,
      }));
      tables[table].push(...inserted);
      return send(res, 201, wantsSingle ? inserted[0] : inserted);
    }

    if (req.method === "DELETE") {
      const matched = new Set(applyFilters(tables[table], searchParams, table));
      tables[table] = tables[table].filter((r) => !matched.has(r));
      return send(res, 200, [...matched]);
    }
  }

  unhandled.push(`${req.method} ${pathname}`);
  console.warn(`[supabase-stub] UNHANDLED ${req.method} ${pathname}${url.search}`);
  return send(res, 501, { message: "stub: unhandled route" });
}

// Bind the port only when this file is RUN (playwright.config.ts's webServer),
// never when it is imported — importing it must not squat on 54321.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  createStubServer().listen(PORT, "127.0.0.1", () => {
    console.log(`[supabase-stub] listening on http://127.0.0.1:${PORT}`);
  });
}
