"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { useUIStore } from "@/stores/ui";
import { kindForMime, extractOnDevice, captureFrameDataUrl } from "@/lib/media/ondevice";
import { buildGenerationPrompt, budgetStatus, formatBytes } from "@/lib/media/formatters";
import { MEDIA_QUOTA_BYTES } from "@/lib/media/formatters";
import {
  admitFiles,
  itemStepLabel,
  patchItem,
  type MediaItem,
} from "@/lib/media/queue";
import {
  GEN_TARGETS,
  DEFAULT_GEN_TARGET,
  type GenTargetId,
  type MediaAttributes,
  type MediaKind,
} from "@/lib/media/types";
import { savePromptAction } from "@/lib/library/actions";
import { TARGET_MODELS, TARGET_DEVELOPER } from "@/lib/constants";
import { DeveloperIcon } from "@/components/models/DeveloperIcon";
import { StreamProgress } from "@/components/feedback/StreamProgress";
import type { Json } from "@/lib/supabase/database.types";

/** Extraction pipeline flag (locked default: proxy, with on-device fallback). */
const EXTRACTION =
  process.env.NEXT_PUBLIC_MEDIA_EXTRACTION === "ondevice" ? "ondevice" : "proxy";

const MODEL_LABEL = new Map<string, string>(TARGET_MODELS.map((m) => [m.id, m.label]));

const KIND_GLYPH: Record<MediaKind, string> = {
  image: "🖼",
  video: "🎞",
  audio: "🎧",
};

export function MediaStudio() {
  const targetModel = useUIStore((s) => s.targetModel);
  const editorDraft = useUIStore((s) => s.editorDraft);
  const setEditorDraft = useUIStore((s) => s.setEditorDraft);
  const fileInput = useRef<HTMLInputElement>(null);

  const [items, setItems] = useState<MediaItem[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  // The generation studio (targets · base prompt · save) tracks the most
  // recently analyzed reference, same as the single-file era.
  const [attrs, setAttrs] = useState<MediaAttributes | null>(null);
  const [kind, setKind] = useState<MediaKind | null>(null);
  const [genTarget, setGenTarget] = useState<GenTargetId>("midjourney");
  const [basePrompt, setBasePrompt] = useState("");
  const [usedBytes, setUsedBytes] = useState(0);
  const [savedId, setSavedId] = useState<string | null>(null);
  const [saving, startSave] = useTransition();

  // Load the running storage total for the Amber budget warning.
  useEffect(() => {
    const supabase = createClient();
    void supabase
      .from("media_assets")
      .select("size_bytes")
      .then(({ data }) => {
        setUsedBytes((data ?? []).reduce((sum, r) => sum + (r.size_bytes ?? 0), 0));
      });
  }, []);

  // Thumbnails are object URLs — revoke them all when the studio unmounts.
  const thumbUrls = useRef<string[]>([]);
  useEffect(
    () => () => {
      for (const url of thumbUrls.current) URL.revokeObjectURL(url);
    },
    [],
  );

  const budget = budgetStatus(usedBytes);
  const busy = items.some((it) =>
    ["queued", "uploading", "analyzing"].includes(it.status),
  );

  const generated = useMemo(() => {
    if (!attrs) return "";
    const base = (basePrompt || editorDraft || "").trim();
    return buildGenerationPrompt(base, attrs, genTarget);
  }, [attrs, basePrompt, editorDraft, genTarget]);

  const patch = (id: string, p: Partial<MediaItem>) =>
    setItems((prev) => patchItem(prev, id, p));

  /** Admit the picked files, then process them one at a time (kinder to the
   *  burst limiter, the cost cap, and a mobile radio than a parallel fan-out). */
  async function onFiles(list: FileList) {
    setNotice(null);
    setSavedId(null);

    const { admitted, rejected } = admitFiles(
      Array.from(list),
      kindForMime,
      usedBytes,
      MEDIA_QUOTA_BYTES,
    );
    if (rejected.length > 0) {
      setNotice(
        `${rejected.length} file${rejected.length === 1 ? "" : "s"} skipped — ${rejected[0]!.reason}`,
      );
    }
    if (admitted.length === 0) return;

    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      setNotice("Sign in to attach media.");
      return;
    }

    const queued = admitted.map(({ file, kind: k }) => {
      const thumbUrl = k === "image" ? URL.createObjectURL(file) : undefined;
      if (thumbUrl) thumbUrls.current.push(thumbUrl);
      return {
        item: {
          id: crypto.randomUUID(),
          name: file.name,
          kind: k,
          sizeBytes: file.size,
          thumbUrl,
          status: "queued",
        } satisfies MediaItem,
        file,
      };
    });
    setItems((prev) => [...prev, ...queued.map((q) => q.item)]);

    for (const { item, file } of queued) {
      await processItem(supabase, user.id, item, file);
    }
  }

  async function processItem(
    supabase: ReturnType<typeof createClient>,
    userId: string,
    item: MediaItem,
    file: File,
  ) {
    const k = item.kind;

    // Upload to the private media bucket under the owner's prefix.
    patch(item.id, { status: "uploading" });
    const ext = file.name.split(".").pop() ?? "bin";
    const path = `${userId}/${crypto.randomUUID()}.${ext}`;
    const { error: upErr } = await supabase.storage
      .from("media")
      .upload(path, file, { contentType: file.type, upsert: false });
    if (upErr) {
      patch(item.id, { status: "error", error: upErr.message });
      return;
    }
    setUsedBytes((b) => b + file.size);

    const { data: asset, error: insErr } = await supabase
      .from("media_assets")
      .insert({ user_id: userId, storage_path: path, kind: k, size_bytes: file.size })
      .select("id")
      .single();
    if (insErr || !asset) {
      patch(item.id, {
        status: "error",
        error: insErr?.message ?? "Couldn't record the asset.",
      });
      return;
    }

    // Extract — proxy (selected model) by default, on-device fallback/audio.
    patch(item.id, { status: "analyzing" });
    const onDevice = await extractOnDevice(file, k);
    let merged: MediaAttributes = onDevice;
    let description: string | undefined;
    let usage: MediaItem["usage"];
    let analysisNote: string | undefined;

    if (EXTRACTION === "proxy" && k !== "audio") {
      const dataUrl = await captureFrameDataUrl(file, k);
      if (dataUrl) {
        try {
          // Analysis runs on the model selected in the composer above.
          const res = await fetch("/api/media", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ dataUrl, target: targetModel }),
          });
          const data = await res.json().catch(() => ({}));
          if (res.ok && data.attributes) {
            description = typeof data.description === "string" ? data.description : undefined;
            merged = { ...onDevice, ...data.attributes, description, source: "proxy" };
            if (data.usage) {
              usage = {
                tokenIn: data.usage.tokenIn ?? 0,
                tokenOut: data.usage.tokenOut ?? 0,
                costUsd: data.usage.costUsd ?? 0,
                target: targetModel,
              };
            }
          } else if (data.notConfigured) {
            analysisNote = `${MODEL_LABEL.get(targetModel) ?? "This model"} isn't configured for vision — used on-device analysis.`;
          } else if (!res.ok) {
            analysisNote = `${data.error ?? "Proxy analysis failed."} Used on-device analysis instead.`;
          }
        } catch {
          /* network — keep the on-device result */
        }
      }
    }

    await supabase
      .from("media_assets")
      .update({ extracted: merged as unknown as Json })
      .eq("id", asset.id);

    patch(item.id, {
      status: "ready",
      attrs: merged,
      description,
      usage,
      error: analysisNote,
    });
    setAttrs(merged);
    setKind(k);
    setGenTarget(DEFAULT_GEN_TARGET[k]);
  }

  function insertDescription(item: MediaItem) {
    if (!item.description) return;
    setEditorDraft(
      editorDraft.trim()
        ? `${editorDraft.trimEnd()}\n\n${item.description}`
        : item.description,
    );
    patch(item.id, { inserted: true });
    document
      .getElementById("prompt-input")
      ?.scrollIntoView({ behavior: "smooth", block: "center" });
  }

  function save() {
    if (!attrs || !generated) return;
    startSave(async () => {
      const res = await savePromptAction({
        input: (basePrompt || editorDraft || "").trim() || "(media reference)",
        output: generated,
        rationale: `Generation prompt from an attached ${kind} reference (${attrs.source}).`,
        mode: "target",
        target: targetModel,
        modelUsed: `media:${attrs.source}`,
        tokenIn: 0,
        tokenOut: 0,
      });
      if (res.ok && res.promptId) setSavedId(res.promptId);
    });
  }

  const targets = GEN_TARGETS.filter((t) => !kind || t.kind === kind);

  return (
    <section className="flex flex-col gap-4" aria-label="Media to generation prompt">
      <div className="flex items-baseline justify-between gap-3">
        <div>
          <h2 className="font-display text-xl tracking-wide text-text">
            Media reference
          </h2>
          <p className="font-body mt-0.5 text-xs text-silver">
            Photos are analyzed by your selected model and feed the prompt above.
          </p>
        </div>
        {budget.warn && (
          <span className="font-body shrink-0 text-xs text-amber">
            ⚠ {formatBytes(budget.usedBytes)} / {formatBytes(budget.quotaBytes)}
          </span>
        )}
      </div>

      <input
        ref={fileInput}
        type="file"
        accept="image/*,video/*,audio/*"
        multiple
        className="hidden"
        onChange={(e) => {
          if (e.target.files?.length) void onFiles(e.target.files);
          e.target.value = "";
        }}
      />
      <button
        type="button"
        onClick={() => fileInput.current?.click()}
        disabled={busy || budget.over}
        className="glass min-h-[48px] rounded-xl border border-dashed border-hair px-4 text-sm text-text transition-shadow hover:shadow-hair disabled:opacity-60"
      >
        {busy
          ? "Working through your files…"
          : budget.over
            ? "Storage full — remove media to continue"
            : "📎 Attach images, video, or audio"}
      </button>

      {notice && (
        <p className="font-body text-sm text-flare" role="alert">
          {notice}
        </p>
      )}

      {/* One card per attached reference: thumb, staged progress, then the
          model's visual description with its usage chip + insert action. */}
      {items.length > 0 && (
        <ul className="flex flex-col gap-3">
          {items.map((item) => (
            <li key={item.id} className="glass flex flex-col gap-3 rounded-2xl p-4">
              <div className="flex items-center gap-3">
                {item.thumbUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={item.thumbUrl}
                    alt=""
                    className="h-12 w-12 shrink-0 rounded-lg object-cover"
                  />
                ) : (
                  <span
                    aria-hidden="true"
                    className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-surface text-lg"
                  >
                    {KIND_GLYPH[item.kind]}
                  </span>
                )}
                <div className="min-w-0 flex-1">
                  <p className="font-body truncate text-sm text-text">{item.name}</p>
                  <p className="font-body text-xs text-silver">
                    {formatBytes(item.sizeBytes)}
                  </p>
                </div>
                {item.usage && (
                  <span className="font-body flex shrink-0 items-center gap-1.5 text-xs tabular-nums text-silver">
                    <DeveloperIcon
                      developer={TARGET_DEVELOPER[item.usage.target]}
                      className="h-3.5 w-3.5 shrink-0 text-accent"
                    />
                    {MODEL_LABEL.get(item.usage.target)} · {item.usage.tokenIn}→
                    {item.usage.tokenOut} tok · ${item.usage.costUsd.toFixed(4)}
                  </span>
                )}
              </div>

              {["queued", "uploading", "analyzing"].includes(item.status) && (
                <StreamProgress
                  indeterminate
                  step={itemStepLabel(item, MODEL_LABEL.get(targetModel) ?? "the model")}
                />
              )}

              {item.status === "error" && (
                <p className="font-body text-sm text-flare" role="alert">
                  {item.error}
                </p>
              )}
              {/* A soft note (vision fallback) on an otherwise ready item. */}
              {item.status === "ready" && item.error && (
                <p className="font-body text-xs text-amber" role="status">
                  {item.error}
                </p>
              )}

              {item.description && (
                <>
                  {/* OUTPUT REGION: model-written description renders in mono. */}
                  <p className="mono whitespace-pre-wrap break-words text-sm text-chalk">
                    {item.description}
                  </p>
                  <div className="flex flex-wrap items-center gap-2">
                    {item.inserted ? (
                      <span className="font-body inline-flex min-h-[44px] items-center gap-1.5 rounded-xl px-4 text-sm text-accent">
                        ✓ In prompt
                      </span>
                    ) : (
                      <button
                        type="button"
                        onClick={() => insertDescription(item)}
                        className="btn-laser min-h-[44px] rounded-xl px-4 text-sm"
                      >
                        ↑ Insert into prompt
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() =>
                        navigator.clipboard?.writeText(item.description ?? "")
                      }
                      className="glass min-h-[44px] rounded-xl px-4 text-sm text-text"
                    >
                      Copy
                    </button>
                  </div>
                </>
              )}
            </li>
          ))}
        </ul>
      )}

      {attrs && (
        <>
          {/* Detected attributes (most recent reference). */}
          <div className="glass flex flex-col gap-2 rounded-2xl p-4">
            <p className="font-body text-xs uppercase tracking-wider text-silver">
              Detected · {attrs.source}
            </p>
            {attrs.palette && attrs.palette.length > 0 && (
              <div className="flex gap-1">
                {attrs.palette.map((hex) => (
                  <span
                    key={hex}
                    title={hex}
                    className="h-5 w-5 rounded"
                    style={{ backgroundColor: hex }}
                  />
                ))}
              </div>
            )}
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
                ] as const
              )
                .filter(([, v]) => v)
                .map(([k, v]) => (
                  <div key={k} className="contents">
                    <dt className="text-silver opacity-70">{k}</dt>
                    <dd className="text-chalk">{v}</dd>
                  </div>
                ))}
            </dl>
          </div>

          {/* Generation target + base prompt. */}
          <div className="flex flex-wrap gap-2">
            {targets.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => setGenTarget(t.id)}
                className={[
                  "font-body rounded-full px-3 py-1.5 text-xs transition-colors",
                  genTarget === t.id
                    ? "bg-laser text-on-laser"
                    : "glass text-silver hover:text-chalk",
                ].join(" ")}
              >
                {t.label}
              </button>
            ))}
          </div>
          <textarea
            value={basePrompt}
            onChange={(e) => setBasePrompt(e.target.value)}
            rows={3}
            placeholder={
              editorDraft ? "Using your editor prompt…" : "Describe what to generate…"
            }
            className="glass font-body w-full resize-y rounded-xl bg-transparent p-3 text-sm text-text placeholder:text-muted focus:outline-none"
          />

          {/* Generation-ready prompt. */}
          <div className="glass rounded-2xl p-4">
            <p className="font-body mb-2 text-xs uppercase tracking-wider text-silver">
              Generation prompt
            </p>
            {/* OUTPUT REGION: generation prompt body in mono (JetBrains). */}
            <p className="mono whitespace-pre-wrap break-words text-sm text-chalk">
              {generated}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => navigator.clipboard?.writeText(generated)}
              className="btn-laser min-h-[44px] rounded-xl px-4 text-sm"
            >
              Copy
            </button>
            {savedId ? (
              <Link
                href={`/library/${savedId}`}
                className="min-h-[44px] rounded-xl bg-pulse px-4 text-sm leading-[44px] text-on-laser"
              >
                Saved ✓ — open
              </Link>
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
          </div>
        </>
      )}
    </section>
  );
}
