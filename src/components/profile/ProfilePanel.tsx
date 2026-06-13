"use client";

import Image from "next/image";
import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { useUIStore } from "@/stores/ui";
import { ThemeSegmented } from "@/components/ThemeToggle";
import { AvatarCropper } from "@/components/avatar-crop/AvatarCropper";
import { updateProfileAction, updateEmailAction } from "@/lib/profile/actions";
import { setPasswordAction } from "@/app/(auth)/actions";
import { TARGET_MODELS, type TargetModelId } from "@/lib/constants";
import type { Profile } from "@/lib/supabase/database.types";

const AUTH_BADGE: Record<string, string> = {
  github: "GitHub",
  google: "Google",
  magic_link: "Email",
};

export function ProfilePanel({ profile, email }: { profile: Profile; email: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const setTargetModel = useUIStore((s) => s.setTargetModel);

  const [pickedFile, setPickedFile] = useState<File | null>(null);
  const [avatarBusy, setAvatarBusy] = useState(false);
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  // Editable identity fields.
  const [fullName, setFullName] = useState(profile.full_name ?? "");
  const [displayName, setDisplayName] = useState(profile.display_name ?? "");
  const [emailField, setEmailField] = useState(email);

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
          {profile.avatar_url ? (
            <Image
              src={profile.avatar_url}
              alt=""
              fill
              sizes="96px"
              className="object-cover"
              unoptimized
            />
          ) : (
            <span className="flex h-full w-full items-center justify-center font-display text-2xl text-silver">
              ◉
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
        <div>
          <p className="font-display text-2xl tracking-wide text-text">
            {profile.full_name || profile.display_name || "Your name"}
          </p>
          <p className="mono text-sm text-silver">
            {profile.display_name ? `@${profile.display_name}` : "set a display name"}
            {profile.auth_method ? ` · ${AUTH_BADGE[profile.auth_method]}` : ""}
          </p>
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
            className="mono w-full rounded-lg bg-transparent text-right text-text placeholder:text-muted focus:outline-none"
          />
        </Field>
        <Divider />
        <Field label="Email">
          <input
            type="email"
            value={emailField}
            onChange={(e) => setEmailField(e.target.value)}
            className="mono w-full rounded-lg bg-transparent text-right text-text placeholder:text-muted focus:outline-none"
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
          <div className="glass rounded-xl">
            <label htmlFor="default-model" className="sr-only">
              Default model
            </label>
            <select
              id="default-model"
              defaultValue={profile.default_model}
              onChange={(e) => changeDefaultModel(e.target.value as TargetModelId)}
              className="font-body rounded-xl bg-transparent px-3 py-2 text-sm text-text focus:outline-none"
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
          className={`mono text-center text-sm ${notice.ok ? "text-pulse" : "text-flare"}`}
          role="status"
        >
          {notice.text}
        </p>
      )}

      {/* Account actions */}
      <form action="/auth/sign-out" method="post">
        <button
          type="submit"
          className="glass flex min-h-[44px] w-full items-center justify-center rounded-xl px-5 text-sm text-flare"
        >
          Sign out
        </button>
      </form>

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
