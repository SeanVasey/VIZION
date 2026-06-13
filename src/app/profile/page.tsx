import type { Metadata } from "next";
import { ScreenHeader } from "@/components/ScreenHeader";
import { ThemeSegmented } from "@/components/ThemeToggle";
import { DefaultModelSelect } from "@/components/profile/DefaultModelSelect";

export const metadata: Metadata = { title: "Profile" };

/** P1 shell of the Profile screen.  Auth, avatar crop, and cross-device sync
 *  land in P2; theme preference already works locally. */
export default function ProfilePage() {
  return (
    <>
      <ScreenHeader title="Profile" />
      <div className="mx-auto flex max-w-screen-sm flex-col gap-6 px-4 py-6">
        {/* Identity placeholder — populated on sign-in (P2). */}
        <div className="flex flex-col items-center gap-3 text-center">
          <div
            className="glass flex h-24 w-24 items-center justify-center rounded-full"
            aria-hidden="true"
          >
            <span className="font-display text-2xl text-silver">◉</span>
          </div>
          <div>
            <p className="font-display text-2xl tracking-wide text-text">Guest</p>
            <p className="mono text-sm text-silver">Sign in to sync — P2</p>
          </div>
        </div>

        {/* Preferences (these persist locally today). */}
        <div className="glass flex flex-col gap-5 rounded-2xl p-5">
          <div className="flex items-center justify-between gap-4">
            <label htmlFor="default-model" className="font-body text-base text-text">
              Default model
            </label>
            <DefaultModelSelect />
          </div>
          <div className="h-px bg-hair" />
          <div className="flex items-center justify-between gap-4">
            <span className="font-body text-base text-text">Theme</span>
            <ThemeSegmented />
          </div>
        </div>

        <div className="glass rounded-2xl p-5 text-center text-sm text-muted">
          Account management, avatar upload + circular crop, and the magic-link → password
          flow arrive in P2.
        </div>
      </div>
    </>
  );
}
