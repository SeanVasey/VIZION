import type { Metadata } from "next";
import { ScreenHeader } from "@/components/ScreenHeader";
import { createClient } from "@/lib/supabase/server";
import { ProfilePanel } from "@/components/profile/ProfilePanel";

export const metadata: Metadata = { title: "Profile" };

/** Profile screen — real account data (product-spec §3.3). Auth is guaranteed
 *  by middleware + the (app) layout. */
export default async function ProfilePage() {
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
      <ScreenHeader title="Profile" />
      <div className="mx-auto max-w-screen-sm px-4 py-6">
        {profile ? (
          <ProfilePanel profile={profile} email={user!.email ?? ""} />
        ) : (
          <p className="glass rounded-2xl p-5 text-center text-sm text-muted">
            We couldn&apos;t load your profile. Try refreshing.
          </p>
        )}
      </div>
    </>
  );
}
