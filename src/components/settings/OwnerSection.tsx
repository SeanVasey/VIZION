"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { updateOwnerSettingsAction } from "@/lib/owner/actions";
import { useSettingWrite } from "@/components/settings/use-setting-write";
import { Divider, Field, FieldStatus, SettingsSection } from "@/components/settings/Field";

/**
 * Owner console (2026-08). Rendered only when the server says the signed-in
 * account is the owner (OWNER_EMAIL match or recorded claimant) — visibility
 * is cosmetic; the server action and the database function re-check on every
 * write. Same persistence idiom as every other section: optimistic apply,
 * useSettingWrite round trip, status beside the control, rollback on failure.
 */
export function OwnerSection({
  openAccess: initialOpenAccess,
  devAccentStrength: initialStrength,
}: {
  openAccess: boolean;
  devAccentStrength: number;
}) {
  const router = useRouter();
  const { status, write } = useSettingWrite();
  const [openAccess, setOpenAccess] = useState(initialOpenAccess);
  const [strength, setStrength] = useState(initialStrength);
  /** The last value the server confirmed — the rollback target. */
  const savedStrength = useRef(initialStrength);

  /** Live-preview the accent alpha app-wide; the authed layout re-renders the
   *  same variable from the database after save. */
  function previewStrength(value: number) {
    document.documentElement.style.setProperty("--dev-peak-user", `${value}%`);
  }

  function saveOpenAccess(next: boolean) {
    setOpenAccess(next);
    write(
      "owner_access",
      async () => {
        const res = await updateOwnerSettingsAction({ openAccess: next });
        if (res.ok) router.refresh();
        return res;
      },
      () => setOpenAccess(!next),
    );
  }

  function commitStrength(value: number) {
    if (value === savedStrength.current) return;
    write(
      "owner_accent",
      async () => {
        const res = await updateOwnerSettingsAction({ devAccentStrength: value });
        if (res.ok) {
          savedStrength.current = value;
          router.refresh();
        }
        return res;
      },
      () => {
        setStrength(savedStrength.current);
        previewStrength(savedStrength.current);
      },
    );
  }

  return (
    <SettingsSection title="Owner">
      <Field label="Open access">
        <button
          type="button"
          role="switch"
          aria-checked={openAccess}
          aria-label="Open access"
          onClick={() => saveOpenAccess(!openAccess)}
          className={`inline-flex h-8 w-14 items-center rounded-full border border-hair p-1 transition-colors ${
            openAccess ? "bg-laser" : "bg-surface"
          }`}
        >
          <span
            aria-hidden="true"
            className={`h-6 w-6 rounded-full transition-transform ${
              openAccess ? "translate-x-6 bg-[var(--on-laser)]" : "translate-x-0 bg-silver"
            }`}
          />
        </button>
      </Field>
      <FieldStatus status={status.owner_access} />
      <p className="font-body text-xs text-silver">
        When off, only you can register for or use VIZION — new sign-ups
        pause and other accounts see a closed notice instead of the app.
      </p>

      <Divider />

      <Field label="Developer accent" htmlFor="owner-accent-strength">
        <div className="flex items-center justify-end gap-3">
          {/* --accent-ink, not --laser: the native thumb must stay legible on
              the LIGHT theme too (laser-on-light is the 1.06:1 failure class). */}
          <input
            id="owner-accent-strength"
            type="range"
            min={0}
            max={60}
            step={1}
            value={strength}
            onChange={(e) => {
              const v = Number(e.target.value);
              setStrength(v);
              previewStrength(v);
            }}
            onPointerUp={() => commitStrength(strength)}
            onKeyUp={(e) => {
              if (e.key !== "Tab") commitStrength(strength);
            }}
            onBlur={() => commitStrength(strength)}
            className="h-8 w-full max-w-[180px] accent-[var(--accent-ink)]"
          />
          <span className="font-body w-10 text-right text-sm tabular-nums text-text">
            {strength}%
          </span>
        </div>
      </Field>
      <FieldStatus status={status.owner_accent} />
      <p className="font-body text-xs text-silver">
        Peak intensity of the developer color field on library cards. Default
        26% — around 20% reads as a whisper, 34%+ as a statement.
      </p>
    </SettingsSection>
  );
}
