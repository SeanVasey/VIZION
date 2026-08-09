"use client";

import { useEffect, useState } from "react";
import { Sheet } from "@/components/ui/Sheet";
import { TARGET_DEVELOPER } from "@/lib/constants";
import { TARGET_LABEL } from "@/lib/providers/formatters";
import { DeveloperIcon } from "@/components/models/DeveloperIcon";
import { buildStyleSnippet, sanitizeName } from "@/lib/media/context";
import { useCopy } from "@/components/ui/use-copy";
import { CheckMark } from "@/components/ui/glyphs";
import type { MediaItem } from "@/lib/media/queue";

/**
 * "View extracted details" (2026-07 UX audit): subject / composition /
 * palette / lighting diagnostics live HERE, behind a tap — never stacked
 * above the primary result. The sheet's primary action follows the
 * attachment's role (insert text / description / style, or open the
 * generation prompt).
 */
export function AttachmentDetailsSheet({
  item,
  onClose,
  onInsert,
  onOpenGenerate,
}: {
  item: MediaItem;
  onClose: () => void;
  onInsert: (itemId: string, text: string) => void;
  onOpenGenerate: (itemId: string) => void;
}) {
  // The describe/extract roles produce EDITABLE text (audit: "an editable
  // description"), seeded from the analysis.
  const seed =
    item.role === "extract" ? (item.extractedText ?? "") : (item.description ?? "");
  const [edited, setEdited] = useState(seed);
  useEffect(() => setEdited(seed), [seed]);

  const { copied, copy } = useCopy();

  const attrs = item.attrs;
  const styleSnippet = attrs ? buildStyleSnippet(attrs) : "";
  const editable = item.role === "describe" || item.role === "extract";
  const primaryInsert =
    item.role === "extract"
      ? { label: "Insert text", text: edited }
      : item.role === "describe"
        ? { label: "Insert into prompt", text: edited }
        : item.role === "style"
          ? { label: "Insert style", text: styleSnippet }
          : null;

  return (
    <Sheet
      open
      onClose={onClose}
      title={`Details — ${sanitizeName(item.name, 24)}`}
      footer={
        primaryInsert ? (
          <button
            type="button"
            disabled={!primaryInsert.text.trim()}
            onClick={() => onInsert(item.id, primaryInsert.text)}
            className="btn-laser flex min-h-[44px] w-full items-center justify-center rounded-xl px-4 text-sm"
          >
            ↑ {primaryInsert.label}
          </button>
        ) : item.role === "generate" ? (
          <button
            type="button"
            onClick={() => onOpenGenerate(item.id)}
            className="btn-laser flex min-h-[44px] w-full items-center justify-center rounded-xl px-4 text-sm"
          >
            Open generation prompt
          </button>
        ) : undefined
      }
    >
      <div className="flex flex-col gap-4">
        {item.usage && (
          <p className="font-body flex items-center gap-1.5 text-xs tabular-nums text-silver">
            <DeveloperIcon
              developer={TARGET_DEVELOPER[item.usage.target]}
              className="h-3.5 w-3.5 shrink-0 text-accent"
            />
            {TARGET_LABEL[item.usage.target]} · {item.usage.tokenIn}→
            {item.usage.tokenOut} tok · {item.usage.estimated ? "≈" : ""}$
            {item.usage.costUsd.toFixed(4)}
          </p>
        )}

        {/* Role-specific body. */}
        {item.role === "extract" ? (
          <>
            <label htmlFor="extract-text" className="sr-only">
              Extracted text
            </label>
            <textarea
              id="extract-text"
              value={edited}
              onChange={(e) => setEdited(e.target.value)}
              rows={6}
              placeholder="No legible text was found."
              className="mono glass w-full resize-y rounded-xl bg-transparent p-3 text-sm text-chalk placeholder:text-muted focus:outline-none"
            />
          </>
        ) : item.description || editable ? (
          <>
            <p className="font-body text-xs uppercase tracking-wider text-silver">
              {item.role === "style" ? "Style read" : "Description"}
            </p>
            {editable ? (
              <>
                <label htmlFor="describe-text" className="sr-only">
                  Editable description
                </label>
                <textarea
                  id="describe-text"
                  value={edited}
                  onChange={(e) => setEdited(e.target.value)}
                  rows={5}
                  className="mono glass w-full resize-y rounded-xl bg-transparent p-3 text-sm text-chalk focus:outline-none"
                />
              </>
            ) : (
              /* OUTPUT REGION: model-written prose renders in mono. */
              <p className="mono whitespace-pre-wrap break-words text-sm text-chalk">
                {item.role === "style" && styleSnippet ? styleSnippet : item.description}
              </p>
            )}
            <button
              type="button"
              onClick={() =>
                void copy(
                  item.role === "style" && styleSnippet
                    ? styleSnippet
                    : editable
                      ? edited
                      : (item.description ?? ""),
                )
              }
              className="glass font-body min-h-[44px] self-start rounded-xl px-4 text-sm text-text hover-hair transition-colors"
            >
              {copied ? (
                <span className="inline-flex items-center gap-1">
                  Copied
                  <CheckMark />
                </span>
              ) : (
                "Copy"
              )}
            </button>
          </>
        ) : null}

        {/* Diagnostics: palette + attribute list. */}
        {attrs?.palette && attrs.palette.length > 0 && (
          <div className="flex gap-1">
            {attrs.palette.map((hex) => (
              <span
                key={hex}
                role="img"
                aria-label={`Palette color ${hex}`}
                title={hex}
                className="h-5 w-5 rounded border border-hair"
                style={{ backgroundColor: hex }}
              />
            ))}
          </div>
        )}
        {attrs && (
          <dl className="font-body grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs text-silver">
            {(
              [
                ["subject", attrs.subject],
                ["composition", attrs.composition],
                ["lighting", attrs.lighting],
                ["style", attrs.style],
                ["mood", attrs.mood],
                ["size", attrs.width ? `${attrs.width}×${attrs.height}` : undefined],
                [
                  "duration",
                  attrs.durationSec ? `${Math.round(attrs.durationSec)}s` : undefined,
                ],
                ["analysis", attrs.source],
              ] as const
            )
              .filter(([, v]) => v)
              .map(([k, v]) => (
                <div key={k} className="contents">
                  {/* No opacity — see MediaPreviewSheet: 70% of --silver is
                      3.33:1 on the light glass. */}
                  <dt className="text-silver">{k}</dt>
                  <dd className="text-chalk">{v}</dd>
                </div>
              ))}
          </dl>
        )}
      </div>
    </Sheet>
  );
}
