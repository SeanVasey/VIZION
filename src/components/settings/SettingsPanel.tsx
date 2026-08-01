"use client";

import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { loadBrowserClient } from "@/lib/supabase/lazy-client";
import { useUIStore } from "@/stores/ui";
import { ThemeSegmented } from "@/components/ThemeToggle";
import { ProviderIcon } from "@/components/auth/ProviderIcon";
import { Footer } from "@/components/Footer";
import { AvatarCropper } from "@/components/avatar-crop/AvatarCropper";
import { Sheet } from "@/components/ui/Sheet";
import { updateProfileAction, updateEmailAction } from "@/lib/profile/actions";
import { setPasswordAction } from "@/app/(auth)/actions";
import { MIN_PASSWORD_LENGTH, PASSWORD_RULE_TEXT } from "@/lib/auth/password";
import { type TargetModelId } from "@/lib/constants";
import { TargetPicker } from "@/components/models/TargetPicker";
import {
  Field,
  Divider,
  FieldStatus,
  SettingsSection,
} from "@/components/settings/Field";
import { useSettingWrite } from "@/components/settings/use-setting-write";
import { DataPrivacySection } from "@/components/settings/DataPrivacySection";
import { AboutSection } from "@/components/settings/AboutSection";
import { OwnerSection } from "@/components/settings/OwnerSection";
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

/** Display-name rule: 3–24 chars, lowercase slug (or empty = unset). */
const DISPLAY_NAME_RE = /^[a-z0-9_-]{3,24}$/;

/**
 * Settings (2026-07 UX audit — the old "Profile" was preferences and account
 * management, not a profile): Identity · Account · Defaults · Appearance ·
 * Data & privacy · About. ONE persistence path (useSettingWrite over server
 * actions) with per-control status; identity is form-commit (Save gated on
 * dirty ∧ valid), discrete pickers are control-commit; email is a distinct
 * verified workflow.
 */
export function SettingsPanel({
  profile,
  email,
  pendingEmail,
  deleteError,
  owner,
}: {
  profile: Profile;
  email: string;
  /** auth.users.new_email — a change awaiting confirmation at the new inbox. */
  pendingEmail: string | null;
  /** delete_error query value the deletion route redirected back with. */
  deleteError?: string;
  /** Owner console state — null for every non-owner account (the server
   *  decides; see src/lib/owner/settings.ts). */
  owner?: { openAccess: boolean; devAccentStrength: number } | null;
}) {
  const router = useRouter();
  const setTargetModel = useUIStore((s) => s.setTargetModel);
  const reducedEffects = useUIStore((s) => s.reducedEffects);
  const setReducedEffects = useUIStore((s) => s.setReducedEffects);
  const { status, write } = useSettingWrite();

  // --- Identity (form-commit: Save enabled only when dirty AND valid) ---
  const [fullName, setFullName] = useState(profile.full_name ?? "");
  const [displayName, setDisplayName] = useState(profile.display_name ?? "");
  const identityDirty =
    fullName !== (profile.full_name ?? "") ||
    displayName !== (profile.display_name ?? "");
  const displayNameValid =
    displayName.trim() === "" || DISPLAY_NAME_RE.test(displayName.trim());

  function saveIdentity() {
    write(
      "identity",
      async () => {
        const res = await updateProfileAction({
          full_name: fullName,
          display_name: displayName,
        });
        if (res.ok) router.refresh();
        return res;
      },
      () => {
        setFullName(profile.full_name ?? "");
        setDisplayName(profile.display_name ?? "");
      },
    );
  }

  // --- Avatar ---
  const [pickedFile, setPickedFile] = useState<File | null>(null);
  const [avatarBusy, setAvatarBusy] = useState(false);
  const [avatarError, setAvatarError] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  // The cropper hands focus back here on close. It can't capture the trigger
  // itself: `fileInput` is display:none, so activeElement at open is <body>.
  const avatarButton = useRef<HTMLButtonElement>(null);
  useEffect(() => setAvatarError(false), [profile.avatar_url]);
  useEffect(() => {
    if (!pickedFile) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !avatarBusy) setPickedFile(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [pickedFile, avatarBusy]);

  async function onAvatarCropped(blob: Blob) {
    setAvatarBusy(true);
    setPickedFile(null);
    write("avatar", async () => {
      try {
        const supabase = await loadBrowserClient();
        const path = `${profile.user_id}/avatar.png`;
        const { error: upErr } = await supabase.storage
          .from("avatars")
          .upload(path, blob, { contentType: "image/png", upsert: true });
        if (upErr) return { ok: false, error: upErr.message };
        const { data } = supabase.storage.from("avatars").getPublicUrl(path);
        const url = `${data.publicUrl}?v=${Date.now()}`; // cache-bust the fixed path
        const res = await updateProfileAction({ avatar_url: url });
        if (res.ok) router.refresh();
        return res;
      } finally {
        setAvatarBusy(false);
      }
    });
  }

  // --- Defaults (control-commit with rollback) ---
  const [defaultModel, setDefaultModel] = useState<TargetModelId>(
    profile.default_model as TargetModelId,
  );
  function changeDefaultModel(model: TargetModelId) {
    const prev = defaultModel;
    setDefaultModel(model);
    setTargetModel(model);
    write(
      "default_model",
      () => updateProfileAction({ default_model: model }),
      () => {
        setDefaultModel(prev);
        setTargetModel(prev);
      },
    );
  }

  // --- Email (distinct verified workflow) ---
  const [emailSheetOpen, setEmailSheetOpen] = useState(false);
  const [newEmail, setNewEmail] = useState("");
  function submitEmailChange() {
    const value = newEmail.trim();
    if (!value) return;
    setEmailSheetOpen(false);
    write("email", async () => {
      const res = await updateEmailAction(value);
      if (res.ok) {
        setNewEmail("");
        router.refresh();
      }
      return res;
    });
  }

  return (
    <div className="flex flex-col gap-6">
      {/* Identity header */}
      <div className="flex flex-col items-center gap-3 text-center">
        <button
          ref={avatarButton}
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
          <FieldStatus status={status.avatar} />
        </div>
      </div>

      {/* Identity — visible input boundaries; Save gated on dirty ∧ valid. */}
      <SettingsSection title="Identity">
        <div className="flex flex-col gap-1.5">
          <label htmlFor="settings-full-name" className="font-body text-sm text-text">
            Full name
          </label>
          <input
            id="settings-full-name"
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            placeholder="Full name"
            autoComplete="name"
            className="font-body w-full rounded-lg border border-hair bg-surface px-3 py-2 text-sm text-text placeholder:text-muted focus:outline-none"
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <label
            htmlFor="settings-display-name"
            className="font-body text-sm text-text"
          >
            Display name
          </label>
          <input
            id="settings-display-name"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            placeholder="unique handle"
            autoComplete="username"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            aria-invalid={!displayNameValid}
            aria-describedby="display-name-rule"
            className={`font-body w-full rounded-lg border bg-surface px-3 py-2 text-sm text-text placeholder:text-muted focus:outline-none ${
              displayNameValid ? "border-hair" : "border-flare"
            }`}
          />
          {/* Name the two symbols and keep the glyph in parentheses. Written as
              a bare "- or _" the line ended on a low, unbracketed underscore at
              12px, which reads as a truncated sentence or a stray caret — it was
              reported as cut-off text, and nothing was actually clipped
              (scrollWidth === clientWidth, no clipping ancestor). Words carry
              the meaning; the parenthesised glyphs keep it exact, since "hyphen"
              alone does not distinguish - from – for a value this is validated
              against. Anything terminal but a bare glyph would do — do not
              revert to one. */}
          <p
            id="display-name-rule"
            className={`font-body text-xs ${displayNameValid ? "text-silver" : "text-flare"}`}
          >
            3–24 characters: lowercase letters, numbers, hyphen (-) or underscore (_)
          </p>
        </div>
        <div className="flex items-center justify-between gap-3">
          <FieldStatus status={status.identity} />
          <button
            type="button"
            onClick={saveIdentity}
            disabled={
              !identityDirty || !displayNameValid || status.identity?.state === "saving"
            }
            className="btn-laser ml-auto flex min-h-[44px] items-center justify-center rounded-xl px-5 text-sm disabled:opacity-50"
          >
            {status.identity?.state === "saving" ? "Saving…" : "Save changes"}
          </button>
        </div>
      </SettingsSection>

      {/* Account — email (verified flow) · password · connection · sign out. */}
      <SettingsSection title="Account">
        <Field label="Email">
          <div className="flex flex-col items-end gap-1">
            <span className="font-body break-all text-sm text-silver">{email}</span>
            <button
              type="button"
              onClick={() => setEmailSheetOpen(true)}
              className="tap-44 font-body text-xs text-accent transition-colors hover:text-chalk"
            >
              Change email
            </button>
          </div>
        </Field>
        {pendingEmail && (
          <p className="font-body rounded-lg border border-hair bg-surface px-3 py-2 text-xs text-amber-ink">
            Confirmation sent to <span className="text-text">{pendingEmail}</span> —
            check that inbox to finish the change.{" "}
            <button
              type="button"
              onClick={() => {
                setNewEmail(pendingEmail);
                write("email", () => updateEmailAction(pendingEmail));
              }}
              // Resting underline (A11Y-007): accent-vs-amber ink is a color-only
              // distinction inside the sentence without it.
              className="text-accent underline decoration-1 underline-offset-2 transition-colors hover:text-chalk"
            >
              Resend
            </button>
          </p>
        )}
        <FieldStatus status={status.email} />
        {profile.auth_method === "magic_link" && (
          <>
            <Divider />
            <ChangePassword write={write} status={status.password} />
          </>
        )}
        <Divider />
        <Field label="Connection">
          <ProviderBadge method={profile.auth_method} />
        </Field>
        <Divider />
        <form action="/auth/sign-out" method="post" className="flex justify-center">
          <button
            type="submit"
            className="btn-destructive font-body min-h-[44px] w-full max-w-[260px] px-5 text-sm"
          >
            Sign out
          </button>
        </form>
      </SettingsSection>

      {/* Defaults. */}
      <SettingsSection title="Defaults">
        <Field label="Default model">
          {/* Same grouped sheet as the composer's target rail — one picker, so
              the two surfaces can't drift in ordering or grouping. */}
          <TargetPicker
            label="Default model"
            value={defaultModel}
            onChange={changeDefaultModel}
            triggerClassName="glass font-body flex min-h-[44px] w-full items-center gap-2 rounded-xl px-3 text-sm text-text hover-hair transition-colors"
          />
        </Field>
        <FieldStatus status={status.default_model} />
      </SettingsSection>

      {/* Appearance. */}
      <SettingsSection title="Appearance">
        <Field label="Theme">
          <ThemeSegmented
            onResult={(res) =>
              write("theme", async () =>
                res.ok
                  ? res
                  : { ok: false, error: "Saved on this device — couldn't sync." },
              )
            }
          />
        </Field>
        <FieldStatus status={status.theme} />
        <Divider />
        <Field label="Reduced effects">
          <button
            type="button"
            role="switch"
            aria-label="Reduced effects"
            aria-checked={reducedEffects}
            onClick={() => setReducedEffects(!reducedEffects)}
            className={`inline-flex h-8 w-14 items-center rounded-full border border-hair p-1 transition-colors ${
              reducedEffects ? "bg-laser" : "bg-surface"
            }`}
          >
            <span
              aria-hidden="true"
              className={`h-6 w-6 rounded-full transition-transform ${
                reducedEffects
                  ? "translate-x-6 bg-on-laser"
                  : "translate-x-0 bg-silver"
              }`}
            />
          </button>
        </Field>
        <p className="font-body text-xs text-silver">
          Turns off the ambient background and shimmer on this device.
        </p>
      </SettingsSection>

      {owner && (
        <OwnerSection
          openAccess={owner.openAccess}
          devAccentStrength={owner.devAccentStrength}
        />
      )}

      <DataPrivacySection deleteError={deleteError} />
      <AboutSection />

      <Footer inset />

      {/* Email change — a distinct verified workflow, not a form field. */}
      <Sheet
        open={emailSheetOpen}
        onClose={() => setEmailSheetOpen(false)}
        title="Change email"
        footer={
          <button
            type="button"
            onClick={submitEmailChange}
            disabled={newEmail.trim() === ""}
            className="btn-laser flex min-h-[44px] w-full items-center justify-center rounded-xl px-4 text-sm disabled:opacity-50"
          >
            Send confirmation
          </button>
        }
      >
        <div className="flex flex-col gap-3">
          <p className="font-body text-sm text-silver">
            We&apos;ll send a confirmation link to the new address. Your sign-in email
            changes only after you confirm it there.
          </p>
          <label htmlFor="settings-new-email" className="sr-only">
            New email address
          </label>
          <input
            id="settings-new-email"
            type="email"
            value={newEmail}
            onChange={(e) => setNewEmail(e.target.value)}
            placeholder="new@address.com"
            autoComplete="email"
            className="font-body w-full rounded-lg border border-hair bg-surface px-3 py-2 text-sm text-text placeholder:text-muted focus:outline-none"
          />
        </div>
      </Sheet>

      {/* Avatar crop modal (scrim mixes alpha explicitly — slash opacity can't
          apply to var() tokens). */}
      {pickedFile && (
        <div className="scrim-in fixed inset-0 z-[60] overflow-y-auto overscroll-contain bg-[color-mix(in_srgb,var(--void)_80%,transparent)]">
          <div
            role="presentation"
            onClick={(e) => {
              if (e.target === e.currentTarget && !avatarBusy) setPickedFile(null);
            }}
            className="flex min-h-full items-center justify-center"
            style={{
              padding:
                "max(1.5rem, env(safe-area-inset-top)) max(1.5rem, env(safe-area-inset-right)) max(1.5rem, env(safe-area-inset-bottom)) max(1.5rem, env(safe-area-inset-left))",
            }}
          >
            <AvatarCropper
              file={pickedFile}
              busy={avatarBusy}
              returnFocusRef={avatarButton}
              onCancel={() => setPickedFile(null)}
              onCropped={onAvatarCropped}
            />
          </div>
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

function ChangePassword({
  write,
  status,
}: {
  write: (
    key: string,
    run: () => Promise<{ ok: boolean; error?: string }>,
  ) => void;
  status: { state: string; message?: string } | undefined;
}) {
  const [open, setOpen] = useState(false);

  function submit(formData: FormData) {
    write("password", async () => {
      const res = await setPasswordAction(null, formData);
      if (res.ok) setOpen(false);
      return res;
    });
  }

  if (!open) {
    return (
      <div className="flex items-center justify-between gap-3">
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="glass min-h-[44px] rounded-xl px-5 text-sm text-text"
        >
          Change password
        </button>
        <FieldStatus status={status as never} />
      </div>
    );
  }

  return (
    <form action={submit} className="flex flex-col gap-3">
      <label htmlFor="change-password" className="sr-only">
        New password
      </label>
      <input
        id="change-password"
        name="password"
        type="password"
        autoComplete="new-password"
        required
        minLength={MIN_PASSWORD_LENGTH}
        placeholder="New password"
        className="font-body w-full rounded-lg border border-hair bg-surface px-3 py-2 text-sm text-text placeholder:text-muted focus:outline-none"
      />
      <label htmlFor="change-password-confirm" className="sr-only">
        Confirm password
      </label>
      <input
        id="change-password-confirm"
        name="confirm"
        type="password"
        autoComplete="new-password"
        required
        minLength={MIN_PASSWORD_LENGTH}
        placeholder="Confirm password"
        className="font-body w-full rounded-lg border border-hair bg-surface px-3 py-2 text-sm text-text placeholder:text-muted focus:outline-none"
      />
      {/* State the rule up front. Discovering it by rejection is the worst way
          to learn a password policy, and `minLength` alone says nothing about
          the character classes the server also enforces. */}
      <p className="font-body text-xs text-silver">{PASSWORD_RULE_TEXT}</p>
      <div className="flex gap-2">
        <button
          type="submit"
          disabled={status?.state === "saving"}
          className="btn-laser min-h-[44px] flex-1 rounded-xl px-5 text-sm disabled:opacity-60"
        >
          {status?.state === "saving" ? "Saving…" : "Update"}
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
