"use client";

import { useRef, useState } from "react";
import { useUIStore } from "@/stores/ui";
import { useToast } from "@/components/ui/Toast";
import { MediaManager } from "@/components/media/MediaManager";
import { SettingsSection, FieldStatus } from "@/components/settings/Field";
import { ConfirmSheet } from "@/components/ui/ConfirmSheet";
import { useSettingWrite } from "@/components/settings/use-setting-write";
import { exportDataAction } from "@/lib/profile/actions";

/** delete_error query values the deletion route redirects back with. */
const DELETE_ERROR_COPY: Record<string, string> = {
  unconfigured:
    "Account deletion isn't configured on the server yet — nothing was deleted.",
  failed: "Something went wrong — nothing was deleted. Try again or contact support.",
};

/**
 * Data & privacy (2026-07 UX audit): the stored-media manager is ALWAYS
 * reachable here (not gated on quota), local drafts can be cleared
 * (undoably), the retention story is written down, the account's data
 * exports as JSON, and the account can be deleted behind a typed
 * confirmation (a native form POST — the component unmounts as the session
 * dies, so useSettingWrite's still-mounted contract doesn't apply).
 */
export function DataPrivacySection({ deleteError }: { deleteError?: string }) {
  const editorDraft = useUIStore((s) => s.editorDraft);
  const setEditorDraft = useUIStore((s) => s.setEditorDraft);
  const { toast } = useToast();
  const { status, write } = useSettingWrite();
  const [exporting, setExporting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const deleteFormRef = useRef<HTMLFormElement>(null);

  function clearDraft() {
    const prior = editorDraft;
    if (prior.trim() === "") return;
    setEditorDraft("");
    toast({
      text: "Draft cleared on this device",
      action: { label: "Undo", onAction: () => setEditorDraft(prior) },
    });
  }

  function exportData() {
    setExporting(true);
    write("export", async () => {
      try {
        const res = await exportDataAction();
        if (res.ok && res.json) {
          const blob = new Blob([res.json], { type: "application/json" });
          const url = URL.createObjectURL(blob);
          const a = document.createElement("a");
          a.href = url;
          a.download = "vizion-export.json";
          a.click();
          URL.revokeObjectURL(url);
        }
        return res;
      } finally {
        setExporting(false);
      }
    });
  }

  return (
    <SettingsSection title="Data & privacy">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="font-body text-base text-text">Draft on this device</p>
          <p className="font-body text-xs text-silver">
            The composer draft is cached locally for convenience.
          </p>
        </div>
        <button
          type="button"
          onClick={clearDraft}
          disabled={editorDraft.trim() === ""}
          className="glass font-body min-h-[44px] shrink-0 rounded-xl px-4 text-sm text-text hover-hair transition-colors disabled:opacity-50"
        >
          Clear draft
        </button>
      </div>

      {/* Stored media — always visible, never quota-gated. */}
      <MediaManager />

      <p className="font-body text-xs leading-relaxed text-silver">
        Prompts and their versions stay until you delete them. Attached media stays in
        your private storage (50 MB) until you remove it here or in the composer tray — or
        attach with &quot;Analyze without keeping&quot; and nothing is stored. Usage
        records are kept for cost-cap accounting.
      </p>

      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="font-body text-base text-text">Export my data</p>
          <p className="font-body text-xs text-silver">
            Profile, prompts, versions, and media metadata as JSON.
          </p>
        </div>
        <button
          type="button"
          onClick={exportData}
          disabled={exporting}
          className="glass font-body min-h-[44px] shrink-0 rounded-xl px-4 text-sm text-text hover-hair transition-colors disabled:opacity-60"
        >
          {exporting ? "Exporting…" : "Export"}
        </button>
      </div>
      <FieldStatus status={status.export} />

      {/* Account deletion — irreversible; typed confirmation + native POST
          (the page navigates away as the session ends). */}
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="font-body text-base text-text">Delete account</p>
          <p className="font-body text-xs text-silver">
            Permanently deletes your sign-in, profile, prompts and all their versions,
            collections, activity, usage records, and stored media. This cannot be undone.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setConfirmDelete(true)}
          className="btn-destructive font-body min-h-[44px] shrink-0 rounded-xl px-4 text-sm"
        >
          Delete…
        </button>
      </div>
      {deleteError && DELETE_ERROR_COPY[deleteError] && (
        <p className="font-body text-sm text-flare" role="alert">
          {DELETE_ERROR_COPY[deleteError]}
        </p>
      )}
      <form ref={deleteFormRef} method="post" action="/auth/delete-account" hidden />
      <ConfirmSheet
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        title="Delete your account?"
        body="Everything goes: sign-in, profile, prompts and versions, collections, activity, usage records, and stored media. Export your data first if you want a copy — there is no undo."
        confirmLabel="Delete my account"
        destructive
        requireText="DELETE"
        onConfirm={() => deleteFormRef.current?.submit()}
      />
    </SettingsSection>
  );
}
