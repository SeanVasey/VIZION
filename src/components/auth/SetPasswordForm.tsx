"use client";

import { useActionState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { setPasswordAction, type ActionResult } from "@/app/(auth)/actions";
import { MIN_PASSWORD_LENGTH, PASSWORD_RULE_TEXT } from "@/lib/auth/password";

/**
 * Magic-link onboarding (A4): convert a passwordless entry into a durable
 * email+password credential. On success we advance into the studio.
 */
export function SetPasswordForm() {
  const router = useRouter();
  const [state, formAction, pending] = useActionState<ActionResult | null, FormData>(
    setPasswordAction,
    null,
  );

  useEffect(() => {
    if (state?.ok) router.replace("/enhance");
  }, [state, router]);

  return (
    <form action={formAction} className="flex w-full flex-col gap-3">
      <label htmlFor="password" className="sr-only">
        New password
      </label>
      <input
        id="password"
        name="password"
        type="password"
        autoComplete="new-password"
        required
        minLength={MIN_PASSWORD_LENGTH}
        placeholder="New password"
        className="glass font-body w-full rounded-xl bg-transparent px-4 py-3 text-center text-base text-text placeholder:text-muted focus:outline-none"
      />
      <label htmlFor="confirm" className="sr-only">
        Confirm password
      </label>
      <input
        id="confirm"
        name="confirm"
        type="password"
        autoComplete="new-password"
        required
        minLength={MIN_PASSWORD_LENGTH}
        placeholder="Confirm password"
        className="glass font-body w-full rounded-xl bg-transparent px-4 py-3 text-center text-base text-text placeholder:text-muted focus:outline-none"
      />
      {/* Stated, not discovered by rejection — and `minLength` says nothing
          about the character classes the server also enforces. */}
      <p className="font-body text-center text-xs text-silver">{PASSWORD_RULE_TEXT}</p>
      <button
        type="submit"
        disabled={pending}
        className="btn-laser flex min-h-[48px] items-center justify-center rounded-xl px-6 text-base"
      >
        {pending ? "Saving…" : "Set password & continue"}
      </button>
      {state?.error && (
        <p className="font-body text-center text-sm text-flare" role="alert">
          {state.error}
        </p>
      )}
    </form>
  );
}
