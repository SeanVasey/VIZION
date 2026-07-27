"use client";

import { useState } from "react";
import { useUIStore } from "@/stores/ui";
import { useToast } from "@/components/ui/Toast";
import { MediaManager } from "@/components/media/MediaManager";
import { SettingsSection, FieldStatus } from "@/components/settings/Field";
import { useSettingWrite } from "@/components/settings/use-setting-write";
import { exportDataAction } from "@/lib/profile/actions";

/**
 * Data & privacy (2026-07 UX audit): the stored-media manager is ALWAYS
 * reachable here (not gated on quota), local drafts can be cleared
 * (undoably), the retention story is written down, and the account's data
 * exports as JSON. Account deletion is deferred (owner decision) — the seam
 * is one more row in this section.
 */
export function DataPrivacySection() {
  const editorDraft = useUIStore((s) => s.editorDraft);
  const setEditorDraft = useUIStore((s) => s.setEditorDraft);
  const { toast } = useToast();
  const { status, write } = useSettingWrite();
  const [exporting, setExporting] = useState(false);

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
        Prompts and their versions stay until you delete them. Attached media stays
        in your private storage (50 MB) until you remove it here or in the composer
        tray — or attach with &quot;Analyze without keeping&quot; and nothing is
        stored. Usage records are kept for cost-cap accounting.
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
    </SettingsSection>
  );
}
