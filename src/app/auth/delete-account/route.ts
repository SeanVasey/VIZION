import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { crossOriginPost } from "@/lib/security/same-origin";
import { rateLimit } from "@/lib/security/rate-limit";

/**
 * Account deletion (POST) — the one consumer of the service-role client.
 *
 * Privilege containment: the ONLY identifier that ever reaches an admin call
 * is `user.id` from the verified session JWT. The route reads no body, no
 * params, no headers — there is nothing request-controlled to vary, and the
 * session check happens before the admin client is even constructed.
 *
 * Deletion order: storage objects first (they do NOT cascade), then the auth
 * user. Every public user-keyed table (profiles, oauth_identities, prompts →
 * prompt_versions, activity_events, usage_events, media_assets, collections)
 * carries FK → auth.users ON DELETE CASCADE — verified live via pg_constraint
 * on 2026-07-27 — so `auth.admin.deleteUser` removes all rows in one step.
 *
 * Lives under the public /auth prefix (like sign-out) so the final redirect
 * works after the session dies mid-flow. Every outcome is a 303.
 */
export async function POST(request: NextRequest) {
  const redirect = (path: string) =>
    NextResponse.redirect(new URL(path, request.nextUrl.origin), { status: 303 });

  // Defense-in-depth on an irreversible service-role deletion (SEC-010):
  // the SameSite=Lax default is the only other CSRF barrier, and it lives in
  // a library default nobody here configures.
  if (crossOriginPost(request)) {
    return NextResponse.json({ error: "Cross-origin request refused." }, { status: 403 });
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return redirect("/sign-in");

  // A burst of deletions is never a human — one confirm sheet per click
  // (SEC-002; advisory in-memory layer, same as the model routes').
  if (!rateLimit(`delete-account:${user.id}`, 3, 3_600_000).allowed) {
    return redirect("/profile?delete_error=rate");
  }

  const admin = createAdminClient();
  if (!admin) {
    console.error("[delete-account] SUPABASE_SERVICE_ROLE_KEY is not configured");
    return redirect("/profile?delete_error=unconfigured");
  }

  try {
    // Media originals: {user_id}/<uuid>.<ext> — paginate the listing so a
    // large library can't strand objects past the first page.
    const mediaStore = admin.storage.from("media");
    for (;;) {
      const { data: objects, error } = await mediaStore.list(user.id, { limit: 100 });
      if (error) throw new Error(`media list failed: ${error.message}`);
      if (!objects || objects.length === 0) break;
      const paths = objects.map((o) => `${user.id}/${o.name}`);
      const { error: rmErr } = await mediaStore.remove(paths);
      if (rmErr) throw new Error(`media remove failed: ${rmErr.message}`);
      if (objects.length < 100) break;
    }
    // Avatar lives at a fixed path; a missing object is not an error.
    await admin.storage.from("avatars").remove([`${user.id}/avatar.png`]);

    // Cascades every public row keyed to this user (see header) and ends the
    // account itself.
    const { error: authErr } = await admin.auth.admin.deleteUser(user.id);
    if (authErr) throw new Error(`auth delete failed: ${authErr.message}`);
  } catch (e) {
    console.error("[delete-account] failed:", e instanceof Error ? e.message : e);
    return redirect("/profile?delete_error=failed");
  }

  // Clear the (now-orphaned) session cookies on this browser.
  await supabase.auth.signOut();
  return redirect("/sign-in?account=deleted");
}
