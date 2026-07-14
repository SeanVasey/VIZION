"use client";

import Image from "next/image";
import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { useUIStore } from "@/stores/ui";
import { ThemeSegmented } from "@/components/ThemeToggle";
import { ProviderIcon } from "@/components/auth/ProviderIcon";
import { Footer } from "@/components/Footer";
import { AvatarCropper } from "@/components/avatar-crop/AvatarCropper";
import { updateProfileAction, updateEmailAction } from "@/lib/profile/actions";
import { setPasswordAction } from "@/app/(auth)/actions";
import { TARGET_MODELS, TARGET_DEVELOPER, type TargetModelId } from "@/lib/constants";
import { DeveloperIcon } from "@/components/models/DeveloperIcon";
import type { Profile } from "@/lib/supabase/database.types";

const AUTH_LABEL: Record<string, string> = {
  github: "Connected with GitHub",
  google: "Connected with Google",
  magic_link: "Signed in with email",
};

/** Auth-provider badge: the branded mark for OAuth, plain text for magic link. */
function ProviderBadge({ method }: { method: string | null }) {
  if (!method) return null;
  const label = AUTH_LABEL[method] ?? method;
  return (
    <span className="font-body inline-flex items-center gap-1.5 text-xs text-silver">
      {method === "github" || method === "google" ? (
        <ProviderIcon provider={method} className="h-4 w-4" />
      ) : null}
      {label}
    </span>
  );
}

export function ProfilePanel({ profile, email }: { profile: Profile; email: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const setTargetModel = useUIStore((s) => s.setTargetModel);

  const [pickedFile, setPickedFile] = useState<File | null>(null);
  const [avatarBusy, setAvatarBusy] = useState(false);
  const [avatarError, setAvatarError] = useState(false);
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  // Editable identity fields.
  const [fullName, setFullName] = useState(profile.full_name ?? "");
  const [displayName, setDisplayName] = useState(profile.display_name ?? "");
  const [emailField, setEmailField] = useState(email);
  // Controlled so the developer mark beside the select tracks the selection.
  const [defaultModel, setDefaultModel] = useState<TargetModelId>(
    profile.default_model as TargetModelId,
  );

  // A freshly saved avatar (new URL) should get another load attempt.
  useEffect(() => setAvatarError(false), [profile.avatar_url]);

  function flash(ok: boolean, text: string) {
    setNotice({ ok, text });
  }

  async function onAvatarCropped(blob: Blob) {
    setAvatarBusy(true);
    setPickedFile(null);
    try {
      const supabase = createClient();
      const path = `${profile.user_id}/avatar.png`;
      const { error: upErr } = await supabase.storage
        .from("avatars")
        .upload(path, blob, { contentType: "image/png", upsert: true });
      if (upErr) throw new Error(upErr.message);

      const { data } = supabase.storage.from("avatars").getPublicUrl(path);
      const url = `${data.publicUrl}?v=${Date.now()}`; // cache-bust the fixed path
      const res = await updateProfileAction({ avatar_url: url });
      if (!res.ok) throw new Error(res.error ?? "Couldn't save avatar.");

      flash(true, "Avatar updated.");
      router.refresh();
    } catch (e) {
      flash(false, e instanceof Error ? e.message : "Avatar upload failed.");
    } finally {
      setAvatarBusy(false);
    }
  }

  function saveIdentity() {
    startTransition(async () => {
      const res = await updateProfileAction({
        full_name: fullName,
        display_name: displayName,
      });
      if (!res.ok) return flash(false, res.error ?? "Couldn't save.");

      if (emailField.trim() && emailField.trim() !== email) {
        const er = await updateEmailAction(emailField);
        if (!er.ok) return flash(false, er.error ?? "Couldn't update email.");
        flash(true, "Saved. Check your inbox to confirm the new email.");
      } else {
        flash(true, "Profile saved.");
      }
      router.refresh();
    });
  }

  function changeDefaultModel(model: TargetModelId) {
    setDefaultModel(model);
    setTargetModel(model);
    startTransition(async () => {
      const res = await updateProfileAction({ default_model: model });
      flash(res.ok, res.ok ? "Default model updated." : (res.error ?? "Failed."));
    });
  }

  return (
    <div className="flex flex-col gap-6">
      {/* Identity header */}
      <div className="flex flex-col items-center gap-3 text-center">
        <button
          type="button"
          onClick={() => fileInput.current?.click()}
          disabled={avatarBusy}
          className="glass relative h-24 w-24 overflow-hidden rounded-full disabled:opacity-60"
          aria-label="Change avatar"
        >
          {profile.avatar_url && !avatarError ? (
            <Image
              src={profile.avatar_url}
              alt=""
              fill
              sizes="96px"
              className="object-cover"
              unoptimized
              onError={() => setAvatarError(true)}
            />
          ) : (
            <span className="flex h-full w-full items-center justify-center font-display text-3xl text-silver">
              {initials(profile.full_name, profile.display_name)}
            </span>
          )}
        </button>
        <input
          ref={fileInput}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) setPickedFile(f);
            e.target.value = "";
          }}
        />
        <div className="flex flex-col items-center gap-1">
          <p className="font-display text-2xl tracking-wide text-text">
            {profile.full_name || profile.display_name || "Your name"}
          </p>
          <p className="font-body text-sm text-silver">
            {profile.display_name ? `@${profile.display_name}` : "set a display name"}
          </p>
          <ProviderBadge method={profile.auth_method} />
        </div>
      </div>

      {/* Editable fields */}
      <div className="glass flex flex-col gap-4 rounded-2xl p-5">
        <Field label="Full name">
          <input
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            placeholder="Full name"
            className="font-body w-full rounded-lg bg-transparent text-right text-text placeholder:text-muted focus:outline-none"
          />
        </Field>
        <Divider />
        <Field label="Display name">
          <input
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            placeholder="unique handle"
            className="font-body w-full rounded-lg bg-transparent text-right text-text placeholder:text-muted focus:outline-none"
          />
        </Field>
        <Divider />
        <Field label="Email">
          <input
            type="email"
            value={emailField}
            onChange={(e) => setEmailField(e.target.value)}
            className="font-body w-full rounded-lg bg-transparent text-right text-text placeholder:text-muted focus:outline-none"
          />
        </Field>
        <button
          type="button"
          onClick={saveIdentity}
          disabled={pending}
          className="btn-laser mt-1 flex min-h-[44px] items-center justify-center rounded-xl px-5 text-sm disabled:opacity-60"
        >
          {pending ? "Saving…" : "Save changes"}
        </button>
      </div>

      {/* Preferences */}
      <div className="glass flex flex-col gap-5 rounded-2xl p-5">
        <Field label="Default model">
          <div className="glass relative flex items-center rounded-xl">
            <label htmlFor="default-model" className="sr-only">
              Default model
            </label>
            {/* Selected model's developer mark (a stale/legacy id gets no mark). */}
            {TARGET_DEVELOPER[defaultModel] && (
              <DeveloperIcon
                developer={TARGET_DEVELOPER[defaultModel]}
                className="pointer-events-none absolute left-3 h-4 w-4 text-accent"
              />
            )}
            <select
              id="default-model"
              value={defaultModel}
              onChange={(e) => changeDefaultModel(e.target.value as TargetModelId)}
              className="font-body w-full rounded-xl bg-transparent py-2 pl-9 pr-3 text-sm text-text focus:outline-none"
            >
              {TARGET_MODELS.map((m) => (
                <option key={m.id} value={m.id} className="bg-onyx text-chalk">
                  {m.label}
                </option>
              ))}
            </select>
          </div>
        </Field>
        <Divider />
        <Field label="Theme">
          <ThemeSegmented />
        </Field>
      </div>

      {profile.auth_method === "magic_link" && <ChangePassword onFlash={flash} />}

      {notice && (
        <p
          className={`font-body text-center text-sm ${notice.ok ? "text-pulse" : "text-flare"}`}
          role="status"
        >
          {notice.text}
        </p>
      )}

      {/* Account actions — capped + centered (the balance rule). */}
      <form action="/auth/sign-out" method="post" className="flex justify-center">
        <button
          type="submit"
          className="btn-destructive font-body min-h-[44px] w-full max-w-[260px] px-5 text-sm"
        >
          Sign out
        </button>
      </form>

      <Footer inset />

      {/* Avatar crop modal */}
      {pickedFile && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-void/80 p-6">
          <AvatarCropper
            file={pickedFile}
            busy={avatarBusy}
            onCancel={() => setPickedFile(null)}
            onCropped={onAvatarCropped}
          />
        </div>
      )}
    </div>
  );
}

/** Up-to-two-letter monogram from the user's name, with a quiet glyph fallback. */
function initials(fullName: string | null, displayName: string | null): string {
  const source = (fullName || displayName || "").trim();
  if (!source) return "◉";
  const parts = source.split(/\s+/).filter(Boolean);
  const letters =
    (parts[0]?.[0] ?? "") + (parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? "") : "");
  return letters.toUpperCase() || "◉";
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <span className="font-body shrink-0 text-base text-text">{label}</span>
      <div className="min-w-0 flex-1 text-right">{children}</div>
    </div>
  );
}

function Divider() {
  return <div className="h-px bg-hair" />;
}

function ChangePassword({ onFlash }: { onFlash: (ok: boolean, text: string) => void }) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  function submit(formData: FormData) {
    startTransition(async () => {
      const res = await setPasswordAction(null, formData);
      onFlash(res.ok, res.ok ? "Password updated." : (res.error ?? "Failed."));
      if (res.ok) setOpen(false);
    });
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="glass min-h-[44px] rounded-xl px-5 text-sm text-text"
      >
        Change password
      </button>
    );
  }

  return (
    <form action={submit} className="glass flex flex-col gap-3 rounded-2xl p-5">
      <input
        name="password"
        type="password"
        autoComplete="new-password"
        required
        minLength={8}
        placeholder="New password"
        className="font-body w-full rounded-lg bg-transparent text-text placeholder:text-muted focus:outline-none"
      />
      <input
        name="confirm"
        type="password"
        autoComplete="new-password"
        required
        minLength={8}
        placeholder="Confirm password"
        className="font-body w-full rounded-lg bg-transparent text-text placeholder:text-muted focus:outline-none"
      />
      <div className="flex gap-2">
        <button
          type="submit"
          disabled={pending}
          className="btn-laser min-h-[44px] flex-1 rounded-xl px-5 text-sm disabled:opacity-60"
        >
          {pending ? "Saving…" : "Update"}
        </button>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="glass min-h-[44px] rounded-xl px-5 text-sm text-silver"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
