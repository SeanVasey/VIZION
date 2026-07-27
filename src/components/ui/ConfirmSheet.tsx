"use client";

import { Sheet } from "@/components/ui/Sheet";

/**
 * Confirmation variant of the bottom sheet — replaces window.confirm for
 * destructive/irreversible actions (stop a run, delete media, purge a prompt).
 */
export function ConfirmSheet({
  open,
  onClose,
  title,
  body,
  confirmLabel,
  destructive = false,
  onConfirm,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  body: string;
  confirmLabel: string;
  destructive?: boolean;
  onConfirm: () => void;
}) {
  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={title}
      footer={
        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={onClose}
            className="btn-secondary flex min-h-[44px] items-center justify-center rounded-xl px-4 text-sm"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => {
              onConfirm();
              onClose();
            }}
            className={`${
              destructive ? "btn-destructive" : "btn-laser"
            } flex min-h-[44px] items-center justify-center rounded-xl px-4 text-sm`}
          >
            {confirmLabel}
          </button>
        </div>
      }
    >
      <p className="font-body text-sm text-silver">{body}</p>
    </Sheet>
  );
}
