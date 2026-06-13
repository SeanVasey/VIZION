import type { Metadata } from "next";
import { Wordmark } from "@/components/Wordmark";
import { SignInForm } from "@/components/auth/SignInForm";

export const metadata: Metadata = { title: "Sign in" };

/**
 * Auth gate (product-spec §3). Unauthenticated visitors land here (enforced by
 * middleware) and see only the brand, a one-line value prop, and the three auth
 * methods — magic link, GitHub, and Google. No DIY auth: Supabase Auth only.
 */
export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;

  return (
    // A <div>, not <main>: the layout's SafeAreaProvider already renders <main>.
    <div className="mx-auto flex min-h-[100dvh] max-w-sm flex-col items-center justify-center gap-8 px-6 pb-safe pt-safe">
      <div className="text-center">
        <Wordmark className="text-3xl" />
        <p className="mt-3 text-sm text-muted">
          Transform any prompt for the engine that&apos;s about to receive it.
        </p>
      </div>

      <SignInForm initialError={error} />
    </div>
  );
}
