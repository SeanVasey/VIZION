"use client";

import { useState } from "react";
import type { ModeId, TargetModelId } from "@/lib/constants";
import type { EnhanceResponse } from "@/lib/enhance/use-enhance";
import { countChanges } from "@/lib/enhance/diff";
import { EXPORTERS, type ExportData, type ExportFormat } from "@/lib/enhance/export";

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
  const changes = countChanges(result.diff);

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
        <p className="mono mb-2 text-xs uppercase tracking-wider text-silver">Input</p>
        <p className="mono whitespace-pre-wrap break-words text-sm text-silver">
          {input}
        </p>
      </div>

      {/* Output — the Chalk end, changed tokens lit in Laser. */}
      <div className="glass rounded-2xl p-4">
        <div className="mb-2 flex items-center justify-between">
          <p className="mono text-xs uppercase tracking-wider text-silver">Enhanced</p>
          <p className="mono text-xs text-laser">
            {changes} change{changes === 1 ? "" : "s"}
          </p>
        </div>
        <p className="mono whitespace-pre-wrap break-words text-sm text-chalk">
          {result.diff.map((seg, i) =>
            seg.op === "removed" ? null : (
              <span key={i} className={seg.op === "added" ? "text-laser" : undefined}>
                {seg.text}
              </span>
            ),
          )}
        </p>
      </div>

      {/* Plain-language rationale. */}
      <div className="rounded-2xl border border-hair p-4">
        <p className="mono mb-1 text-xs uppercase tracking-wider text-silver">
          What changed
        </p>
        <p className="font-body text-sm text-text">{result.rationale}</p>
        <p className="mono mt-3 text-xs text-silver">
          {result.modelUsed} · {result.tokenIn}→{result.tokenOut} tok · $
          {result.costUsd.toFixed(4)}
        </p>
      </div>

      {/* Copy / share / export. */}
      <div className="flex flex-wrap items-center gap-2">
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
        <span className="mono ml-1 text-xs text-silver">Export</span>
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
    </section>
  );
}
