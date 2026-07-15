"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { ProviderIcon } from "@/components/auth/ProviderIcon";

type Status =
  | { kind: "idle" }
  | { kind: "sending" }
  | { kind: "sent" }
  | { kind: "error"; message: string };

const PROVIDER_LABEL = {
  github: "Continue with GitHub",
  google: "Continue with Google",
} as const;

/** Human copy for the machine slugs the auth callback/confirm routes emit. */
const ERROR_COPY: Record<string, string> = {
  missing_code: "That sign-in link was incomplete — request a fresh one.",
  invalid_link: "That sign-in link is invalid or has expired — request a fresh one.",
};

export function SignInForm({ initialError }: { initialError?: string }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  // Magic link is the default entry; the password path exercises the durable
  // credential set during onboarding (product-spec §3.2 / A4).
  const [withPassword, setWithPassword] = useState(false);
  const [status, setStatus] = useState<Status>(
    initialError
      ? { kind: "error", message: ERROR_COPY[initialError] ?? initialError }
      : { kind: "idle" },
  );

  // Backing out of the OAuth consent screen can restore this page from the
  // back/forward cache with `sending` state intact — every control would stay
  // disabled with no way back. pageshow(persisted) returns the form to idle.
  useEffect(() => {
    const onShow = (e: PageTransitionEvent) => {
      if (e.persisted) setStatus({ kind: "idle" });
    };
    window.addEventListener("pageshow", onShow);
    return () => window.removeEventListener("pageshow", onShow);
  }, []);

  const origin = typeof window !== "undefined" ? window.location.origin : "";

  async function submitEmail(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim()) return;
    setStatus({ kind: "sending" });
    const supabase = createClient();

    if (withPassword) {
      const { error } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password,
      });
      if (error) {
        setStatus({ kind: "error", message: error.message });
        return;
      }
      // Full navigation so middleware sees the fresh session cookies.
      window.location.assign("/enhance");
      return;
    }

    const { error } = await supabase.auth.signInWithOtp({
      email: email.trim(),
      options: { emailRedirectTo: `${origin}/auth/callback` },
    });
    setStatus(error ? { kind: "error", message: error.message } : { kind: "sent" });
  }

  async function signInWithProvider(provider: "github" | "google") {
    setStatus({ kind: "sending" });
    const supabase = createClient();
    const { error } = await supabase.auth.signInWithOAuth({
      provider,
      options: { redirectTo: `${origin}/auth/callback` },
    });
    // On success the browser is redirected to the provider; only errors return.
    if (error) setStatus({ kind: "error", message: error.message });
  }

  const busy = status.kind === "sending";

  if (status.kind === "sent") {
    return (
      <div
        className="glass mx-auto w-full max-w-[300px] rounded-2xl p-5 text-center"
        role="status"
      >
        <p className="font-display text-balance text-xl tracking-wide text-text">
          Check your email
        </p>
        <p className="font-body mt-2 text-pretty text-sm text-muted">
          We sent a magic link to{" "}
          <span className="font-body font-medium text-text">{email}</span>. Open it on
          this device to continue.
        </p>
        {/* Not a dead end: a typo'd address needs an in-app way back (the
            installed PWA has no URL bar to reload from). */}
        <button
          type="button"
          onClick={() => setStatus({ kind: "idle" })}
          className="font-body mt-3 min-h-[44px] text-sm text-accent underline-offset-4 hover:underline"
        >
          Use a different email
        </button>
      </div>
    );
  }

  return (
    // Capped + centered: every auth control is content-width (the balance rule).
    <div className="mx-auto flex w-full max-w-[300px] flex-col gap-3">
      {/* OAuth — branded marks, equal weight. */}
      {(["google", "github"] as const).map((provider) => (
        <button
          key={provider}
          type="button"
          disabled={busy}
          onClick={() => signInWithProvider(provider)}
          className="btn-secondary font-body flex min-h-[48px] w-full items-center justify-center gap-3 px-4 text-sm disabled:opacity-60"
        >
          <ProviderIcon provider={provider} />
          {PROVIDER_LABEL[provider]}
        </button>
      ))}

      <div className="flex items-center gap-3" aria-hidden="true">
        <span className="h-px flex-1 bg-hair" />
        <span className="font-body text-xs text-silver">or</span>
        <span className="h-px flex-1 bg-hair" />
      </div>

      {/* Email — magic link by default, or the password credential set during
          onboarding (A4: email+password is the durable path). */}
      <form onSubmit={submitEmail} className="flex flex-col gap-2">
        <label htmlFor="email" className="sr-only">
          Email address
        </label>
        <input
          id="email"
          type="email"
          inputMode="email"
          autoComplete="email"
          enterKeyHint={withPassword ? "next" : "send"}
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@example.com"
          className="glass font-body w-full rounded-xl bg-transparent px-4 py-3 text-center text-base text-text placeholder:text-muted focus:outline-none"
        />
        {withPassword && (
          <>
            <label htmlFor="password" className="sr-only">
              Password
            </label>
            <input
              id="password"
              type="password"
              autoComplete="current-password"
              enterKeyHint="go"
              required
              minLength={8}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Password"
              className="glass font-body w-full rounded-xl bg-transparent px-4 py-3 text-center text-base text-text placeholder:text-muted focus:outline-none"
            />
          </>
        )}
        <button
          type="submit"
          disabled={busy}
          className="btn-laser font-body flex min-h-[48px] items-center justify-center rounded-xl px-6 text-base disabled:opacity-60"
        >
          {busy
            ? withPassword
              ? "Signing in…"
              : "Sending…"
            : withPassword
              ? "Sign in"
              : "Email me a magic link"}
        </button>
        <button
          type="button"
          onClick={() => setWithPassword((v) => !v)}
          className="font-body min-h-[44px] text-sm text-silver transition-colors hover:text-chalk"
        >
          {withPassword ? "Use a magic link instead" : "Have a password? Sign in with it"}
        </button>
      </form>

      {status.kind === "error" && (
        <p className="font-body text-center text-sm text-flare" role="alert">
          {status.message}
        </p>
      )}
    </div>
  );
}
