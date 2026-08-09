"use client";

import { useEffect, useState } from "react";
import { Sheet } from "@/components/ui/Sheet";
import { PressableButton } from "@/components/ui/PressableButton";

/**
 * Confirmation variant of the bottom sheet — replaces window.confirm for
 * destructive/irreversible actions (stop a run, delete media, purge a prompt).
 *
 * `requireText` raises the bar for the truly irreversible (account deletion):
 * the confirm button stays disabled until the user types the exact phrase.
 */
export function ConfirmSheet({
  open,
  onClose,
  title,
  body,
  confirmLabel,
  destructive = false,
  requireText,
  onConfirm,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  body: string;
  confirmLabel: string;
  destructive?: boolean;
  /** Exact phrase the user must type before confirm enables. */
  requireText?: string;
  onConfirm: () => void;
}) {
  const [typed, setTyped] = useState("");
  // A reopened sheet must never inherit a previously typed confirmation.
  useEffect(() => {
    if (open) setTyped("");
  }, [open]);
  const blocked = requireText !== undefined && typed !== requireText;

  // The destructive arm keeps its per-site dim: only .btn-laser carries a
  // :disabled rule of its own (audit VAR-12).
  const confirmVariant = destructive
    ? "btn-destructive disabled:opacity-50"
    : "btn-laser";

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={title}
      footer={
        <div className="grid grid-cols-2 gap-2">
          <PressableButton
            subtle
            onClick={onClose}
            className="btn-secondary flex min-h-[44px] items-center justify-center rounded-xl px-4 text-sm"
          >
            Cancel
          </PressableButton>
          <PressableButton
            subtle
            disabled={blocked}
            onClick={() => {
              onConfirm();
              onClose();
            }}
            className={`${confirmVariant} flex min-h-[44px] items-center justify-center rounded-xl px-4 text-sm`}
          >
            {confirmLabel}
          </PressableButton>
        </div>
      }
    >
      <p className="font-body text-sm text-silver">{body}</p>
      {requireText !== undefined && (
        <div className="mt-3 flex flex-col gap-1.5">
          <label htmlFor="confirm-phrase" className="font-body text-xs text-silver">
            Type <span className="text-text">{requireText}</span> to confirm
          </label>
          <input
            id="confirm-phrase"
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            autoComplete="off"
            autoCapitalize="off"
            spellCheck={false}
            className="glass font-body w-full rounded-xl border border-hair bg-transparent px-4 py-2.5 text-base text-text focus:outline-none"
          />
        </div>
      )}
    </Sheet>
  );
}
