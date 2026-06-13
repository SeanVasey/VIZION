import type { Metadata } from "next";
import { Wordmark } from "@/components/Wordmark";

export const metadata: Metadata = { title: "Sign in" };

/**
 * Auth gate (P1 shell stub).  The unauthenticated state shows only the brand, a
 * one-line value prop, and the three auth methods (product-spec §3).  The
 * methods are inert here; Supabase Auth (magic link + GitHub + Google) is wired
 * in P2 — no DIY auth, ever.
 */
const METHODS = [
  { id: "magic", label: "Continue with email", hint: "Magic link" },
  { id: "github", label: "Continue with GitHub", hint: "OAuth" },
  { id: "google", label: "Continue with Google", hint: "OAuth" },
] as const;

export default function SignInPage() {
  return (
    <main className="mx-auto flex min-h-[100dvh] max-w-sm flex-col items-center justify-center gap-8 px-6 pb-safe pt-safe">
      <div className="text-center">
        <Wordmark className="text-3xl" />
        <p className="mt-3 text-sm text-muted">
          Transform any prompt for the engine that&apos;s about to receive it.
        </p>
      </div>

      <div className="flex w-full flex-col gap-3">
        {METHODS.map((m) => (
          <button
            key={m.id}
            type="button"
            disabled
            className="glass flex w-full items-center justify-between rounded-xl px-4 py-3 text-left text-text disabled:opacity-70"
            title="Auth is wired in P2"
          >
            <span className="font-body">{m.label}</span>
            <span className="mono text-xs text-silver">{m.hint}</span>
          </button>
        ))}
      </div>

      <p className="mono text-center text-xs text-silver">
        Supabase Auth · arrives in P2
      </p>
    </main>
  );
}
