"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";

type Status =
  | { kind: "idle" }
  | { kind: "sending" }
  | { kind: "sent" }
  | { kind: "error"; message: string };

const PROVIDER_LABEL = {
  github: "Continue with GitHub",
  google: "Continue with Google",
} as const;

export function SignInForm({ initialError }: { initialError?: string }) {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<Status>(
    initialError ? { kind: "error", message: initialError } : { kind: "idle" },
  );

  const origin = typeof window !== "undefined" ? window.location.origin : "";

  async function sendMagicLink(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim()) return;
    setStatus({ kind: "sending" });
    const supabase = createClient();
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
      <div className="glass rounded-xl p-5 text-center" role="status">
        <p className="font-display text-xl tracking-wide text-text">Check your email</p>
        <p className="mt-2 text-sm text-muted">
          We sent a magic link to <span className="mono text-chalk">{email}</span>. Open
          it on this device to continue.
        </p>
      </div>
    );
  }

  return (
    <div className="flex w-full flex-col gap-4">
      <form onSubmit={sendMagicLink} className="flex flex-col gap-2">
        <label htmlFor="email" className="sr-only">
          Email address
        </label>
        <input
          id="email"
          type="email"
          inputMode="email"
          autoComplete="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@example.com"
          className="glass font-body w-full rounded-xl bg-transparent px-4 py-3 text-base text-text placeholder:text-muted focus:outline-none"
        />
        <button
          type="submit"
          disabled={busy}
          className="btn-laser flex min-h-[48px] items-center justify-center rounded-xl px-6 text-base disabled:opacity-60"
        >
          {busy ? "Sending…" : "Email me a magic link"}
        </button>
      </form>

      <div className="flex items-center gap-3" aria-hidden="true">
        <span className="h-px flex-1 bg-hair" />
        <span className="mono text-xs text-silver">or</span>
        <span className="h-px flex-1 bg-hair" />
      </div>

      <div className="flex flex-col gap-3">
        {(["github", "google"] as const).map((provider) => (
          <button
            key={provider}
            type="button"
            disabled={busy}
            onClick={() => signInWithProvider(provider)}
            className="glass font-body flex min-h-[48px] w-full items-center justify-center rounded-xl px-4 text-text disabled:opacity-60"
          >
            {PROVIDER_LABEL[provider]}
          </button>
        ))}
      </div>

      {status.kind === "error" && (
        <p className="mono text-center text-sm text-flare" role="alert">
          {status.message}
        </p>
      )}
    </div>
  );
}
