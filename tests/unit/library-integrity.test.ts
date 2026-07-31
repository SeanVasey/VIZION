import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Phase 1.5 — write integrity and account scoping.
 *
 * Four defects, one theme: state that belongs to ONE thing leaking into
 * another, because the boundary was assumed rather than enforced.
 *
 *   1. A library save was four independent writes. A failure part-way left a
 *      prompt with no version, and the content-hash duplicate check then had
 *      nothing to match on, so the retry minted a second orphan.
 *   2. `prompts.current_ver` could point at a version of a DIFFERENT prompt.
 *   3. The offline outbox is keyed to the ORIGIN, so one account's queued
 *      draft replayed into whoever signed in next on a shared device.
 *   4. The service worker cached authenticated HTML into origin-wide Cache
 *      Storage, so a session change could paint the previous account's library.
 *
 * Plus the persisted `editorDraft`, which leaked the same way as (3).
 */

const ROOT = join(__dirname, "..", "..");
const MIGRATION = "20260730234204_library_integrity.sql";

function sql(): string {
  return readFileSync(join(ROOT, "supabase", "migrations", MIGRATION), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/--[^\n]*/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function source(...parts: string[]): string {
  return readFileSync(join(ROOT, ...parts), "utf8");
}

const SQL = sql();
const ACTIONS = source("src", "lib", "library", "actions.ts");
const OUTBOX = source("src", "lib", "pwa", "outbox.ts");
const FLUSHER = source("src", "components", "pwa", "OutboxFlusher.tsx");
const SW = source("src", "lib", "pwa", "sw-src.js");
const HYDRATOR = source("src", "components", "ProfileHydrator.tsx");

describe("a library save is one transaction", () => {
  it("writes prompt, version, pointer and activity in a single function", () => {
    expect(SQL).toMatch(/create or replace function public\.library_save_prompt/);
    const body = SQL.slice(SQL.indexOf("library_save_prompt"));
    expect(body).toMatch(/insert into public\.prompts/);
    expect(body).toMatch(/insert into public\.prompt_versions/);
    expect(body).toMatch(/update public\.prompts set current_ver/);
    expect(body).toMatch(/insert into public\.activity_events/);
  });

  it("locks the parent row when appending a version", () => {
    // Without `for update`, two concurrent appends read the same current_ver
    // and both claim it as their parent.
    expect(SQL).toMatch(
      /select current_ver into v_parent from public\.prompts where id = p_prompt_id for update/,
    );
    expect(SQL).toMatch(/if not found then raise exception 'prompt_not_found'/);
  });

  it("keeps authorization in RLS — these are INVOKER, not DEFINER", () => {
    // A DEFINER function here would move the library's entire authorization
    // story out of RLS and into the function body. Nothing here needs to
    // exceed the caller's rights.
    for (const fn of ["library_save_prompt", "library_add_version"]) {
      expect(SQL).toMatch(
        new RegExp(
          `function public\\.${fn}\\([\\s\\S]*?security invoker[\\s\\S]*?set search_path = public`,
        ),
      );
      expect(SQL).toMatch(
        new RegExp(
          `revoke execute on function public\\.${fn}[\\s\\S]*?from anon, public`,
        ),
      );
      expect(SQL).toMatch(
        new RegExp(`grant execute on function public\\.${fn}[\\s\\S]*?to authenticated`),
      );
    }
  });

  it("takes the owner from auth.uid(), never from an argument", () => {
    expect(SQL).toMatch(
      /insert into public\.prompts \(user_id[^)]*\) values \(auth\.uid\(\)/,
    );
    expect(SQL).not.toMatch(/p_user_id/);
  });

  it("is what the action calls, instead of four separate writes", () => {
    expect(ACTIONS).toMatch(/\.rpc\(\s*"library_save_prompt"/);
    expect(ACTIONS).toMatch(/\.rpc\(\s*"library_add_version"/);
    // The shapes that produced orphans.
    expect(ACTIONS).not.toMatch(/from\(\s*"prompt_versions"\s*\)\s*\.insert/);
    expect(ACTIONS).not.toMatch(/from\(\s*"prompts"\s*\)\s*\.insert/);
  });
});

describe("current_ver cannot cross a prompt boundary", () => {
  it("is enforced by a trigger, not only by the caller", () => {
    // The application predicate can be bypassed by any direct PostgREST write;
    // the trigger cannot.
    expect(SQL).toMatch(
      /create or replace function public\.enforce_prompt_current_version/,
    );
    expect(SQL).toMatch(
      /where v\.id = new\.current_ver and v\.prompt_id = new\.id[\s\S]*?raise exception 'version_not_owned_by_prompt'/,
    );
    expect(SQL).toMatch(
      /before insert or update of current_ver on public\.prompts for each row/,
    );
  });

  it("allows a null pointer", () => {
    // A prompt is inserted before its first version exists, so the guard has
    // to ignore null or the save could never happen.
    expect(SQL).toMatch(/if new\.current_ver is not null and not exists/);
  });

  it("only fires on current_ver, so ordinary edits do not pay for it", () => {
    // `update of current_ver` — a rename, a tag change, a favourite toggle and
    // a soft delete must not run the lookup.
    expect(SQL).toMatch(/update of current_ver/);
  });

  it("restoreVersionAction checks ownership and fails closed", () => {
    expect(ACTIONS).toMatch(
      /from\("prompt_versions"\)[\s\S]*?\.eq\("id", versionId\)[\s\S]*?\.eq\("prompt_id", promptId\)/,
    );
    expect(ACTIONS).toMatch(/if \(!restored\) \{[\s\S]*?doesn't belong to this prompt/);
  });
});

describe("the outbox is scoped to an account", () => {
  it("records the owner on every queued item", () => {
    expect(OUTBOX).toMatch(/userId\?: string;/);
    expect(OUTBOX).toMatch(/export async function enqueueOutbox\(\s*userId: string,/);
  });

  it("replays only this account's items", () => {
    expect(OUTBOX).toMatch(/export async function flushOutbox\(\s*userId: string,/);
    expect(OUTBOX).toMatch(/\.filter\(\(item\) => item\.userId === userId\)/);
  });

  it("treats a duplicate as drained", () => {
    // `res.ok` alone left an item that the server already had in the store
    // forever: every online/visibilitychange retried it, and it could never
    // succeed because the duplicate check was what rejected it.
    expect(FLUSHER).toMatch(/return res\.ok \|\| Boolean\(res\.duplicate\)/);
  });

  it("is given the owner by the authenticated layout", () => {
    expect(FLUSHER).toMatch(/OutboxFlusher\(\{ userId \}: \{ userId: string \}\)/);
    expect(source("src", "app", "(app)", "layout.tsx")).toMatch(
      /<OutboxFlusher userId=\{user\.id\} \/>/,
    );
  });
});

describe("the composer draft does not survive an account change", () => {
  it("clears editorDraft when the hydrated account differs", () => {
    expect(HYDRATOR).toMatch(
      /const accountChanged = previous !== null && previous !== userId/,
    );
    expect(HYDRATOR).toMatch(/accountChanged \? \{ editorDraft: "" \} : \{\}/);
  });

  it("adopts rather than clears on a first load", () => {
    // `previous === null` is a fresh device or state from a build before this
    // existed. Clearing there would delete a draft that probably belongs to
    // the person signing in.
    expect(HYDRATOR).toMatch(/previous !== null/);
  });

  it("persists the owner so the NEXT load can compare", () => {
    expect(source("src", "stores", "ui.ts")).toMatch(/userId: state\.userId,/);
  });
});

describe("the service worker does not cache account content", () => {
  /**
   * Scoped to `isShellAsset` — the CACHING predicate — on purpose.
   *
   * A blanket `not.toMatch(/request.mode === "navigate"/)` over the whole file
   * looks equivalent and is wrong: `setCatchHandler` tests the same expression
   * to decide what to serve when a navigation FAILS. Banning it everywhere
   * would have deleted the offline fallback in the name of fixing a cache
   * leak. (This assertion was written the broad way first and caught itself.)
   */
  const isShellAsset = SW.slice(
    SW.indexOf("const isShellAsset"),
    SW.indexOf("registerRoute("),
  );

  it("no longer caches navigations into shared Cache Storage", () => {
    expect(isShellAsset).not.toMatch(/request\.mode === "navigate"/);
    expect(isShellAsset).toMatch(
      /return \["script", "style", "font", "image"\]\.includes\(request\.destination\)/,
    );
  });

  it("still ROUTES navigations, with a strategy that never caches", () => {
    // The bug this exists for: deleting the navigation route entirely looks
    // like the fix and silently removes offline support. `setCatchHandler`
    // only runs for a request some Workbox route handled — an unrouted
    // navigation never enters Workbox, so offline it fails to the browser's
    // own error page and /offline.html is never served.
    //
    // Asserting the ABSENCE of caching is therefore only half the property.
    // The other half is that navigations are still routed, by NetworkOnly.
    // The e2e offline spec caught this; this test makes it fail in 30ms
    // instead of after a full browser run.
    expect(SW).toMatch(/import \{ NetworkOnly[^}]*\} from "workbox-strategies"/);
    expect(SW).toMatch(
      /registerRoute\(\s*\(\{ request \}\) => request\.mode === "navigate",\s*new NetworkOnly\(\)\s*\)/,
    );
  });

  it("still serves the offline fallback for a failed navigation", () => {
    expect(SW).toMatch(/setCatchHandler/);
    expect(SW).toMatch(/offline\.html/);
  });
});

describe("the migration stays inert for the enum contract", () => {
  it("adds no model_target labels", () => {
    expect(SQL).not.toMatch(/ALTER TYPE model_target/i);
  });
});
