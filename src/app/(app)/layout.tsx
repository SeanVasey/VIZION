import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { needsPasswordOnboarding } from "@/lib/auth/onboarding";
import { getAppSettings, isOwnerUser } from "@/lib/owner/settings";
import { ProfileHydrator } from "@/components/ProfileHydrator";
import { OutboxFlusher } from "@/components/pwa/OutboxFlusher";
import { ToastProvider } from "@/components/ui/Toast";
import { NewPromptFab } from "@/components/nav/NewPromptFab";

/**
 * Authenticated app shell. Middleware guarantees a session here; this layout
 * additionally enforces the magic-link → set-password onboarding gate (D15/A4),
 * the owner's closed-access switch, and hydrates the user's saved preferences
 * into the UI store.
 */
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Middleware should have redirected already; this is defence in depth.
  if (!user) redirect("/sign-in");

  const settings = await getAppSettings(supabase);

  // Owner switch: when access is closed, non-owner sessions get a notice
  // instead of the app. The model routes enforce the same rule independently
  // — this screen is the honest UX for it, not the security boundary.
  if (!settings.openAccess && !isOwnerUser(user, settings)) {
    return (
      <main className="mx-auto flex min-h-dvh max-w-screen-sm items-center px-4">
        <div className="glass w-full rounded-2xl p-6 text-center">
          <h1 className="font-display text-2xl tracking-wide text-text">
            Access is closed
          </h1>
          <p className="font-body mt-3 text-sm text-silver">
            The owner has temporarily closed VIZ(IO)N to other accounts. Your
            data is safe and will be here when access reopens.
          </p>
          <form action="/auth/sign-out" method="post" className="mt-5">
            <button type="submit" className="btn-secondary min-h-[44px] w-full max-w-[260px]">
              Sign out
            </button>
          </form>
        </div>
      </main>
    );
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("auth_method, password_set, theme, default_model")
    .eq("user_id", user.id)
    .maybeSingle();

  if (needsPasswordOnboarding(profile)) redirect("/set-password");

  return (
    <ToastProvider>
      <ProfileHydrator
        theme={profile?.theme ?? "system"}
        defaultModel={profile?.default_model ?? "opus_5"}
        userId={user.id}
      />
      <OutboxFlusher userId={user.id} />
      {/* display:contents — no box, but the owner-tuned accent variable still
          inherits to every library card below (see dev-accents.css). */}
      <div
        className="contents"
        style={{ "--dev-peak-user": `${settings.devAccentStrength}%` } as React.CSSProperties}
      >
        {children}
      </div>
      {/* Inside ToastProvider, not the root layout: the button raises toasts,
          and useToast throws outside the provider. Authed-only chrome belongs
          in the authed shell anyway — `showsNewPromptFab` picks the routes. */}
      <NewPromptFab />
    </ToastProvider>
  );
}
