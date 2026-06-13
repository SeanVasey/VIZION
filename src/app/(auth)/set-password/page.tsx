import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { needsPasswordOnboarding } from "@/lib/auth/onboarding";
import { Wordmark } from "@/components/Wordmark";
import { SetPasswordForm } from "@/components/auth/SetPasswordForm";

export const metadata: Metadata = { title: "Set a password" };

/**
 * Magic-link onboarding step (A4). Only reachable by a signed-in account that
 * still needs a password; everyone else is bounced to where they belong.
 */
export default async function SetPasswordPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/sign-in");

  const { data: profile } = await supabase
    .from("profiles")
    .select("auth_method, password_set")
    .eq("user_id", user.id)
    .maybeSingle();

  if (!needsPasswordOnboarding(profile)) redirect("/enhance");

  return (
    <div className="mx-auto flex min-h-[100dvh] max-w-sm flex-col items-center justify-center gap-8 px-6 pb-safe pt-safe">
      <div className="text-center">
        <Wordmark className="text-2xl" />
        <h1 className="mt-4 font-display text-xl tracking-wide text-text">
          Secure your account
        </h1>
        <p className="mt-2 text-sm text-muted">
          Set a password so you can sign in even without a magic link. You can still use
          magic links any time.
        </p>
      </div>
      <SetPasswordForm />
    </div>
  );
}
