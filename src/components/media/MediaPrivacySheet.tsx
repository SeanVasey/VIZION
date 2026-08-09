"use client";

import { Sheet } from "@/components/ui/Sheet";
import { PressableButton } from "@/components/ui/PressableButton";

/**
 * First-attach disclosure (2026-07 UX audit, privacy): upload, model
 * processing, cost, and retention are stated BEFORE anything leaves the
 * device, and "analyze without keeping" is a first-class choice — the vision
 * proxy takes a data URL, so analysis never requires an upload.
 */
export function MediaPrivacySheet({
  open,
  modelLabel,
  onClose,
  onChoose,
}: {
  open: boolean;
  modelLabel: string;
  onClose: () => void;
  /** `store` = keep originals in private storage; false = ephemeral. */
  onChoose: (store: boolean) => void;
}) {
  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Before you attach"
      footer={
        <div className="flex flex-col gap-2">
          <PressableButton
            subtle
            onClick={() => onChoose(true)}
            className="btn-laser flex min-h-[44px] items-center justify-center rounded-xl px-4 text-sm"
          >
            Attach &amp; store
          </PressableButton>
          <PressableButton
            subtle
            onClick={() => onChoose(false)}
            className="btn-secondary flex min-h-[44px] items-center justify-center rounded-xl px-4 text-sm"
          >
            Analyze without keeping
          </PressableButton>
        </div>
      }
    >
      <ul className="font-body flex flex-col gap-2.5 text-sm text-text">
        <li className="flex gap-2">
          <span aria-hidden="true" className="text-accent">
            ▸
          </span>
          Files upload to your private VIZION storage (50 MB per account) and stay until
          you remove them — manage anytime in Settings → Data &amp; privacy.
        </li>
        <li className="flex gap-2">
          <span aria-hidden="true" className="text-accent">
            ▸
          </span>
          A downscaled frame is sent to {modelLabel} for analysis. Analysis counts toward
          your daily usage cap.
        </li>
        <li className="flex gap-2">
          <span aria-hidden="true" className="text-accent">
            ▸
          </span>
          Prefer not to store the file? Choose &quot;Analyze without keeping&quot; — the
          file never uploads; only this session sees it.
        </li>
      </ul>
      <p className="font-body mt-3 text-xs text-silver">
        You can change the storage default any time from the tray&apos;s
        &quot;Originals&quot; toggle.
      </p>
    </Sheet>
  );
}
