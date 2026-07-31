import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { needsPasswordOnboarding } from "@/lib/auth/onboarding";
import { ProfileHydrator } from "@/components/ProfileHydrator";
import { OutboxFlusher } from "@/components/pwa/OutboxFlusher";
import { ToastProvider } from "@/components/ui/Toast";
import { NewPromptFab } from "@/components/nav/NewPromptFab";

/**
 * Authenticated app shell. Middleware guarantees a session here; this layout
 * additionally enforces the magic-link → set-password onboarding gate (D15/A4)
 * and hydrates the user's saved preferences into the UI store.
 */
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Middleware should have redirected already; this is defence in depth.
  if (!user) redirect("/sign-in");

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
      {children}
      {/* Inside ToastProvider, not the root layout: the button raises toasts,
          and useToast throws outside the provider. Authed-only chrome belongs
          in the authed shell anyway — `showsNewPromptFab` picks the routes. */}
      <NewPromptFab />
    </ToastProvider>
  );
}
