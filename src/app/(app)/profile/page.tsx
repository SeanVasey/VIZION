import type { Metadata } from "next";
import { ScreenHeader } from "@/components/ScreenHeader";
import { createClient } from "@/lib/supabase/server";
import { SettingsPanel } from "@/components/settings/SettingsPanel";

export const metadata: Metadata = { title: "Settings" };

/** Settings screen (2026-07 UX audit — formerly "Profile": the content was
 *  preferences and account management, so the screen now says so). The route
 *  stays /profile to avoid URL churn. Auth is guaranteed by middleware + the
 *  (app) layout. */
export default async function SettingsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data: profile } = await supabase
    .from("profiles")
    .select("*")
    .eq("user_id", user!.id)
    .single();

  return (
    <>
      <ScreenHeader title="Settings" />
      <div className="mx-auto max-w-screen-sm px-4 py-6">
        {profile ? (
          <SettingsPanel
            profile={profile}
            email={user!.email ?? ""}
            pendingEmail={user!.new_email ?? null}
          />
        ) : (
          <p className="glass rounded-2xl p-5 text-center text-sm text-muted">
            We couldn&apos;t load your settings. Try refreshing.
          </p>
        )}
      </div>
    </>
  );
}
