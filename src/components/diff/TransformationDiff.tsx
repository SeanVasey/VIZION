"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { TARGET_DEVELOPER, type ModeId, type TargetModelId } from "@/lib/constants";
import type { EnhanceResponse } from "@/lib/enhance/use-enhance";
import { DeveloperIcon } from "@/components/models/DeveloperIcon";
import { countChanges } from "@/lib/enhance/diff";
import { EXPORTERS, type ExportData, type ExportFormat } from "@/lib/enhance/export";
import { savePromptAction } from "@/lib/library/actions";
import { enqueueOutbox } from "@/lib/pwa/outbox";

/**
 * The transformation diff (product-spec §1.1, §4.1) — the brand's signature
 * gesture. Input on the Void end, enhanced output on the Chalk end, changed
 * tokens lit in Laser, with a plain-language rationale and copy/share/export.
 */
export function TransformationDiff({
  input,
  mode,
  target,
  result,
}: {
  input: string;
  mode: ModeId;
  target: TargetModelId;
  result: EnhanceResponse;
}) {
  const [copied, setCopied] = useState(false);
  const [savedId, setSavedId] = useState<string | null>(null);
  const [queued, setQueued] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saving, startSave] = useTransition();
  const changes = countChanges(result.diff);

  function save() {
    setSaveError(null);
    const payload = {
      input,
      output: result.output,
      rationale: result.rationale,
      mode,
      target,
      modelUsed: result.modelUsed,
      tokenIn: result.tokenIn,
      tokenOut: result.tokenOut,
    };
    startSave(async () => {
      // Offline → queue to the outbox; it flushes on reconnect/foreground.
      if (typeof navigator !== "undefined" && navigator.onLine === false) {
        await enqueueOutbox("save-prompt", payload);
        setQueued(true);
        return;
      }
      try {
        const res = await savePromptAction(payload);
        if (res.ok && res.promptId) setSavedId(res.promptId);
        else setSaveError(res.error ?? "Couldn't save.");
      } catch {
        await enqueueOutbox("save-prompt", payload);
        setQueued(true);
      }
    });
  }

  const exportData: ExportData = {
    input,
    output: result.output,
    rationale: result.rationale,
    mode,
    target,
    modelUsed: result.modelUsed,
  };

  async function copyOutput() {
    try {
      await navigator.clipboard.writeText(result.output);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard unavailable; no-op */
    }
  }

  async function share() {
    const text = result.output;
    if (typeof navigator !== "undefined" && "share" in navigator) {
      try {
        await navigator.share({ title: "VIZ(IO)N prompt", text });
        return;
      } catch {
        /* user cancelled or unsupported; fall through to copy */
      }
    }
    await copyOutput();
  }

  function download(format: ExportFormat) {
    const exp = EXPORTERS[format];
    const blob = new Blob([exp.render(exportData)], { type: exp.mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `vizion-${mode}.${exp.ext}`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <section className="flex flex-col gap-4" aria-label="Transformation diff">
      {/* Input — the Void end. */}
      <div className="rounded-2xl border border-hair bg-void/60 p-4">
        <p className="font-body mb-2 text-xs uppercase tracking-wider text-silver">
          Input
        </p>
        {/* OUTPUT REGION: the prompt body renders in mono (JetBrains). */}
        <p className="mono whitespace-pre-wrap break-words text-sm text-silver">
          {input}
        </p>
      </div>

      {/* Output — the Chalk end, changed tokens lit in Laser. */}
      <div className="glass result-shimmer rounded-2xl p-4">
        <div className="mb-2 flex items-center justify-between">
          <p className="font-body text-xs uppercase tracking-wider text-silver">
            Enhanced
          </p>
          <div className="flex items-center gap-2.5">
            <p className="font-body text-xs text-accent">
              {changes} change{changes === 1 ? "" : "s"}
            </p>
            {/* Quick copy — a 44px tap target that doesn't inflate the header row. */}
            <button
              type="button"
              onClick={copyOutput}
              aria-label={copied ? "Copied" : "Copy enhanced prompt"}
              className="-my-2 -mr-1.5 flex h-11 w-11 items-center justify-center rounded-full text-silver transition-colors hover:text-chalk focus-visible:text-chalk"
            >
              {copied ? (
                <svg aria-hidden="true" viewBox="0 0 24 24" className="h-5 w-5 text-accent">
                  <path
                    d="M20 6L9 17l-5-5"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              ) : (
                <svg aria-hidden="true" viewBox="0 0 24 24" className="h-5 w-5">
                  <rect
                    x="9"
                    y="9"
                    width="12"
                    height="12"
                    rx="2.5"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.75"
                  />
                  <path
                    d="M5.5 15H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v.5"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.75"
                    strokeLinecap="round"
                  />
                </svg>
              )}
            </button>
          </div>
        </div>
        {/* OUTPUT REGION: result text + diff tokens render in mono (JetBrains). */}
        <p className="mono whitespace-pre-wrap break-words text-sm text-chalk">
          {result.diff.map((seg, i) =>
            seg.op === "removed" ? null : (
              <span key={i} className={seg.op === "added" ? "text-accent" : undefined}>
                {seg.text}
              </span>
            ),
          )}
        </p>
      </div>

      {/* Plain-language rationale. */}
      <div className="rounded-2xl border border-hair p-4">
        <p className="font-body mb-1 text-xs uppercase tracking-wider text-silver">
          What changed
        </p>
        <p className="font-body text-sm text-text">{result.rationale}</p>
        <p className="font-body mt-3 flex items-center gap-1.5 text-xs text-silver">
          <DeveloperIcon
            developer={TARGET_DEVELOPER[target]}
            className="h-3.5 w-3.5 shrink-0 text-accent"
          />
          {result.modelUsed} · {result.tokenIn}→{result.tokenOut} tok · $
          {result.costUsd.toFixed(4)}
        </p>
      </div>

      {/* Save / copy / share / export. */}
      <div className="flex flex-wrap items-center gap-2">
        {savedId ? (
          <Link
            href={`/library/${savedId}`}
            className="min-h-[44px] rounded-xl bg-pulse px-4 text-sm leading-[44px] text-on-laser"
          >
            Saved ✓ — open
          </Link>
        ) : queued ? (
          <span className="font-body min-h-[44px] rounded-xl bg-amber px-4 text-sm leading-[44px] text-on-laser">
            Queued — syncs when online
          </span>
        ) : (
          <button
            type="button"
            onClick={save}
            disabled={saving}
            className="glass min-h-[44px] rounded-xl px-4 text-sm text-text disabled:opacity-60"
          >
            {saving ? "Saving…" : "Save to library"}
          </button>
        )}
        <button
          type="button"
          onClick={copyOutput}
          className="btn-laser min-h-[44px] rounded-xl px-4 text-sm"
        >
          {copied ? "Copied ✓" : "Copy"}
        </button>
        <button
          type="button"
          onClick={share}
          className="glass min-h-[44px] rounded-xl px-4 text-sm text-text"
        >
          Share
        </button>
        <span className="font-body ml-1 text-xs text-silver">Export</span>
        {(Object.keys(EXPORTERS) as ExportFormat[]).map((fmt) => (
          <button
            key={fmt}
            type="button"
            onClick={() => download(fmt)}
            className="glass min-h-[44px] rounded-xl px-3 text-xs uppercase text-silver hover:text-chalk"
          >
            {fmt}
          </button>
        ))}
      </div>
      {saveError && (
        <p className="font-body text-sm text-flare" role="alert">
          {saveError}
        </p>
      )}
    </section>
  );
}
