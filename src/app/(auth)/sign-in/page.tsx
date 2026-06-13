import type { Metadata } from "next";
import { AuthHero } from "@/components/auth/AuthHero";
import { SignInForm } from "@/components/auth/SignInForm";
import { Footer } from "@/components/Footer";

export const metadata: Metadata = { title: "Sign in" };

/**
 * Auth gate (product-spec §3). Unauthenticated visitors land here (enforced by
 * middleware) and see the brand mark hero, the three auth methods, the brand/
 * version pills, and the canonical footer — over the animated background.
 * No DIY auth: Supabase Auth only.
 */
export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;

  return (
    // A <div>, not <main>: the layout's SafeAreaProvider already renders <main>.
    <div className="mx-auto flex min-h-[100dvh] max-w-sm flex-col items-center justify-between gap-8 px-6 pt-safe">
      <div className="flex flex-1 flex-col items-center justify-center gap-8 py-8">
        <AuthHero />
        <SignInForm initialError={error} />
      </div>
      <Footer />
    </div>
  );
}
