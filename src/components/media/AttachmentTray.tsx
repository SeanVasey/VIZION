"use client";

import { useEffect, useId, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useUIStore } from "@/stores/ui";
import { kindForMime, extractOnDevice, captureFrameDataUrl } from "@/lib/media/ondevice";
import { budgetStatus, MEDIA_QUOTA_BYTES } from "@/lib/media/formatters";
import { admitFiles, itemStepLabel, patchItem, type MediaItem } from "@/lib/media/queue";
import {
  DEFAULT_GEN_TARGET,
  DEFAULT_ROLE,
  ROLE_META,
  rolesForKind,
  type AttachmentRole,
  type MediaAttributes,
  type MediaKind,
} from "@/lib/media/types";
import {
  storeAttachment,
  removeAsset,
  type MediaStoreDeps,
} from "@/lib/media/pipeline";
import { buildMediaContext, sanitizeName } from "@/lib/media/context";
import { TARGET_MODELS, type TargetModelId } from "@/lib/constants";
import { StreamProgress } from "@/components/feedback/StreamProgress";
import { Sheet } from "@/components/ui/Sheet";
import { useToast } from "@/components/ui/Toast";
import { MediaPrivacySheet } from "@/components/media/MediaPrivacySheet";
import { AttachmentDetailsSheet } from "@/components/media/AttachmentDetailsSheet";
import { GenerateSheet } from "@/components/media/GenerateSheet";
import { MediaManager } from "@/components/media/MediaManager";
import type { Json } from "@/lib/supabase/database.types";

/** The attach button's mark — an arrow leaving a tray, i.e. an upload.
 *  Deliberately not the old 📎 emoji: a paperclip renders at whatever size and
 *  weight the platform font decides, and next to a 12px label it read as
 *  decoration on a text link rather than the button's verb. */
function UploadGlyph({ className }: { className?: string }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className={className}>
      <path
        d="M12 15V4m0 0L8 8m4-4l4 4M5 15v3.5A1.5 1.5 0 006.5 20h11a1.5 1.5 0 001.5-1.5V15"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** Extraction pipeline flag (locked default: proxy, with on-device fallback). */
const EXTRACTION =
  process.env.NEXT_PUBLIC_MEDIA_EXTRACTION === "ondevice" ? "ondevice" : "proxy";

const MODEL_LABEL_MAP = new Map<string, string>(
  TARGET_MODELS.map((m) => [m.id, m.label]),
);

const KIND_GLYPH: Record<MediaKind, string> = {
  image: "🖼",
  video: "🎞",
  audio: "🎧",
};

/** Route intent per role ("generate" analyzes like a reference). */
const ROLE_INTENT: Record<
  AttachmentRole,
  "reference" | "describe" | "style" | "extract_text"
> = {
  reference: "reference",
  describe: "describe",
  style: "style",
  extract: "extract_text",
  generate: "reference",
};

/** Analysis family — roles within a family share results, across families a
 *  role change re-analyzes. */
function intentFamily(role: AttachmentRole): "reference" | "style" | "extract_text" {
  const intent = ROLE_INTENT[role];
  return intent === "describe" ? "reference" : intent;
}

function supabaseDeps(supabase: ReturnType<typeof createClient>): MediaStoreDeps {
  return {
    reserve: async (input) => {
      const { data, error } = await supabase.rpc("media_reserve", {
        p_kind: input.kind,
        p_size_bytes: input.sizeBytes,
        p_original_name: input.originalName,
        p_mime_type: input.mimeType,
        p_ext: input.ext,
        p_role: input.role,
      });
      if (error) throw new Error(error.message);
      const row = data?.[0];
      if (!row) throw new Error("Reservation failed.");
      return { id: row.id, storagePath: row.storage_path };
    },
    uploadObject: async (path, blob, contentType) => {
      const { error } = await supabase.storage
        .from("media")
        .upload(path, blob, { contentType, upsert: false });
      if (error) throw new Error(error.message);
    },
    setStatus: async (id, status) => {
      const { error } = await supabase
        .from("media_assets")
        .update({ status })
        .eq("id", id);
      if (error) throw new Error(error.message);
    },
    deleteRow: async (id) => {
      const { error } = await supabase.from("media_assets").delete().eq("id", id);
      if (error) throw new Error(error.message);
    },
    removeObject: async (path) => {
      const { error } = await supabase.storage.from("media").remove([path]);
      if (error) {
        if (/not.?found/i.test(error.message)) return { notFound: true };
        throw new Error(error.message);
      }
      return {};
    },
  };
}

/**
 * The composer's attachment tray (2026-07 UX audit): media lives INSIDE the
 * composer, every attachment carries an explicit role (reference by default —
 * never inferred to "generate"), per-kind capability is labeled honestly, and
 * reference context flows into the enhance request via `onContextChange`.
 */
export function AttachmentTray({
  onContextChange,
  intakeRef,
}: {
  onContextChange?: (blocks: string[]) => void;
  /** Filled with the tray's file-intake so the composer can hand over pasted
   *  and dropped files. It routes through `onPick`, which owns the first-run
   *  privacy disclosure — nothing may reach `admitFiles` around that gate. */
  intakeRef?: { current: ((files: File[] | FileList) => void) | null };
}) {
  const targetModel = useUIStore((s) => s.targetModel);
  const editorDraft = useUIStore((s) => s.editorDraft);
  const setEditorDraft = useUIStore((s) => s.setEditorDraft);
  const mediaNoticeAcknowledged = useUIStore((s) => s.mediaNoticeAcknowledged);
  const setMediaNoticeAcknowledged = useUIStore((s) => s.setMediaNoticeAcknowledged);
  const mediaStoreByDefault = useUIStore((s) => s.mediaStoreByDefault);
  const setMediaStoreByDefault = useUIStore((s) => s.setMediaStoreByDefault);
  const { toast } = useToast();

  const fileInput = useRef<HTMLInputElement>(null);
  const [items, setItems] = useState<MediaItem[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const [capUsage, setCapUsage] = useState<{ todayCost: number; capUsd: number } | null>(
    null,
  );
  const [usedBytes, setUsedBytes] = useState(0);
  const [privacyOpen, setPrivacyOpen] = useState(false);
  /** The rail's `?` disclosure — what each media kind actually contributes. */
  const [helpOpen, setHelpOpen] = useState(false);
  const helpId = useId();
  const [detailsFor, setDetailsFor] = useState<string | null>(null);
  const [roleFor, setRoleFor] = useState<string | null>(null);
  const [generateFor, setGenerateFor] = useState<string | null>(null);
  const pendingFiles = useRef<File[] | null>(null);
  /** In-session File handles (thumbnails, re-analysis, generation). */
  const filesRef = useRef(new Map<string, File>());
  const thumbUrls = useRef<string[]>([]);

  useEffect(
    () => () => {
      for (const url of thumbUrls.current) URL.revokeObjectURL(url);
    },
    [],
  );

  // Storage budget readout (server-enforced by media_reserve; this is UX).
  useEffect(() => {
    void loadUsage();
  }, []);

  async function loadUsage() {
    const supabase = createClient();
    const { data } = await supabase.from("media_assets").select("size_bytes");
    setUsedBytes((data ?? []).reduce((sum, r) => sum + (r.size_bytes ?? 0), 0));
  }

  // Reference-role context feeds the enhance request.
  useEffect(() => {
    onContextChange?.(buildMediaContext(items));
  }, [items, onContextChange]);

  const budget = budgetStatus(usedBytes);
  const busy = items.some((it) =>
    ["queued", "reserving", "uploading", "analyzing"].includes(it.status),
  );

  const patch = (id: string, p: Partial<MediaItem>) =>
    setItems((prev) => patchItem(prev, id, p));

  function onPick(list: FileList | File[]) {
    const files = Array.from(list);
    if (files.length === 0) return;
    if (!mediaNoticeAcknowledged) {
      // First attach on this device: disclose before anything uploads.
      pendingFiles.current = files;
      setPrivacyOpen(true);
      return;
    }
    void proceed(files, !mediaStoreByDefault);
  }

  // Publish intake to the composer (paste / drop). No dep array on purpose:
  // `onPick` closes over state that changes every render, and a stale closure
  // here would route pasted files past the privacy gate's current answer.
  useEffect(() => {
    if (!intakeRef) return;
    intakeRef.current = onPick;
    return () => {
      intakeRef.current = null;
    };
  });

  /** Admit + queue + process sequentially (kinder to the burst limiter, the
   *  cost cap, and a mobile radio than a parallel fan-out). */
  async function proceed(files: File[], ephemeral: boolean) {
    setNotice(null);
    const { admitted, rejected } = admitFiles(
      files,
      kindForMime,
      ephemeral ? 0 : usedBytes,
      ephemeral ? Number.MAX_SAFE_INTEGER : MEDIA_QUOTA_BYTES,
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

    // Capture the analysis target at pick time — a mid-queue selector flip
    // must not relabel in-flight work.
    const analysisTarget = targetModel;
    const queued = admitted.map(({ file, kind: k }) => {
      const thumbUrl = k === "image" ? URL.createObjectURL(file) : undefined;
      if (thumbUrl) thumbUrls.current.push(thumbUrl);
      const item: MediaItem = {
        id: crypto.randomUUID(),
        name: file.name,
        kind: k,
        sizeBytes: file.size,
        thumbUrl,
        status: "queued",
        role: DEFAULT_ROLE,
        ephemeral,
        analysisTarget,
        genTarget: DEFAULT_GEN_TARGET[k],
      };
      filesRef.current.set(item.id, file);
      return { item, file };
    });
    setItems((prev) => [...prev, ...queued.map((q) => q.item)]);

    for (const { item, file } of queued) {
      await processItem(supabase, item, file);
    }
  }

  async function processItem(
    supabase: ReturnType<typeof createClient>,
    item: MediaItem,
    file: File,
  ) {
    // 1 · Store (reserve → upload → ready), unless ephemeral.
    let assetId: string | undefined;
    if (!item.ephemeral) {
      const outcome = await storeAttachment(
        supabaseDeps(supabase),
        {
          blob: file,
          name: file.name,
          mimeType: file.type,
          sizeBytes: file.size,
          ext: file.name.split(".").pop() ?? "bin",
          kind: item.kind,
          role: item.role,
        },
        (stage) => patch(item.id, { status: stage }),
      );
      if (!outcome.ok) {
        patch(item.id, { status: "error", error: outcome.message });
        return;
      }
      assetId = outcome.assetId;
      patch(item.id, { assetId, storagePath: outcome.storagePath });
      setUsedBytes((b) => b + file.size);
      if (outcome.softNote) setNotice(outcome.softNote);
    }

    // 2 · Analyze.
    await analyzeItem(supabase, { ...item, assetId }, file, item.role);
  }

  /** The analysis half of the pipeline — reusable for role changes. */
  async function analyzeItem(
    supabase: ReturnType<typeof createClient>,
    item: MediaItem,
    file: File,
    role: AttachmentRole,
  ) {
    patch(item.id, { status: "analyzing" });
    const analysisTarget = item.analysisTarget ?? targetModel;
    const onDevice = await extractOnDevice(file, item.kind);
    let merged: MediaAttributes = onDevice;
    let description: string | undefined;
    let extractedText: string | undefined;
    let usage: MediaItem["usage"];
    let analysisNote: string | undefined;

    if (EXTRACTION === "proxy" && item.kind !== "audio") {
      const dataUrl = await captureFrameDataUrl(file, item.kind);
      if (dataUrl) {
        try {
          const res = await fetch("/api/media", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              dataUrl,
              target: analysisTarget,
              intent: ROLE_INTENT[role],
            }),
          });
          const data = await res.json().catch(() => ({}));
          if (res.ok) {
            const analyzedWith: TargetModelId = MODEL_LABEL_MAP.has(data.usage?.target)
              ? (data.usage.target as TargetModelId)
              : analysisTarget;
            if (data.usage) {
              usage = {
                tokenIn: data.usage.tokenIn ?? 0,
                tokenOut: data.usage.tokenOut ?? 0,
                costUsd: data.usage.costUsd ?? 0,
                target: analyzedWith,
              };
              if (typeof data.usage.todayCost === "number") {
                setCapUsage({
                  todayCost: data.usage.todayCost,
                  capUsd: data.usage.capUsd ?? 0,
                });
              }
            }
            if (typeof data.text === "string") {
              extractedText = data.text;
            } else if (data.attributes) {
              description =
                typeof data.description === "string" ? data.description : undefined;
              merged = { ...onDevice, ...data.attributes, description, source: "proxy" };
            }
            if (data.fallbackFrom) {
              analysisNote = `${MODEL_LABEL_MAP.get(analysisTarget) ?? "The selected model"} couldn't analyze this — used ${MODEL_LABEL_MAP.get(analyzedWith) ?? "another model"} instead.`;
            }
          } else if (data.notConfigured) {
            analysisNote = `${MODEL_LABEL_MAP.get(analysisTarget) ?? "This model"} isn't configured for vision — used on-device analysis.`;
          } else {
            analysisNote = `${data.error ?? "Analysis failed."} Used on-device analysis instead.`;
          }
        } catch {
          analysisNote = "Analysis needs a connection — kept the on-device result.";
        }
      } else {
        analysisNote =
          "Couldn't capture a frame from this file — used on-device analysis.";
      }
    }

    if (item.assetId) {
      // Fire-and-forget cache of the extraction on the stored row.
      void supabase
        .from("media_assets")
        .update({ extracted: merged as unknown as Json })
        .eq("id", item.assetId)
        .then(() => {});
    }

    patch(item.id, {
      status: "ready",
      attrs: merged,
      description,
      extractedText,
      usage,
      error: analysisNote,
      analyzedIntent: intentFamily(role),
    });
  }

  function changeRole(item: MediaItem, role: AttachmentRole) {
    setRoleFor(null);
    if (role === item.role) return;
    patch(item.id, { role });
    if (item.assetId) {
      const supabase = createClient();
      void supabase.from("media_assets").update({ role }).eq("id", item.assetId);
    }
    // A role in a different analysis family needs a fresh pass (billed like
    // the original analysis — it is one).
    if (
      item.status === "ready" &&
      item.kind !== "audio" &&
      intentFamily(role) !== item.analyzedIntent
    ) {
      const file = filesRef.current.get(item.id);
      if (file) {
        void analyzeItem(createClient(), { ...item, role }, file, role);
      } else {
        patch(item.id, {
          error: "Re-attach this file to analyze it under the new role.",
        });
      }
    }
    if (role === "generate") setGenerateFor(item.id);
  }

  async function removeItem(item: MediaItem) {
    if (item.assetId && item.storagePath) {
      const outcome = await removeAsset(supabaseDeps(createClient()), {
        id: item.assetId,
        storagePath: item.storagePath,
      });
      if (!outcome.ok) {
        toast({ tone: "error", text: outcome.message });
        return;
      }
      setUsedBytes((b) => Math.max(0, b - item.sizeBytes));
    }
    if (item.thumbUrl) URL.revokeObjectURL(item.thumbUrl);
    filesRef.current.delete(item.id);
    setItems((prev) => prev.filter((it) => it.id !== item.id));
  }

  /** Append text to the prompt draft (the insert actions' shared tail). */
  function insertText(itemId: string, text: string) {
    const t = text.trim();
    if (!t) return;
    setEditorDraft(editorDraft.trim() ? `${editorDraft.trimEnd()}\n\n${t}` : t);
    patch(itemId, { inserted: true });
    setDetailsFor(null);
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    document
      .getElementById("prompt-input")
      ?.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "center" });
  }

  /** Honest per-kind processing line (2026-07 capability-honesty fix). */
  function destinationLine(item: MediaItem): string {
    const model =
      item.usage?.target != null
        ? `Analyzed by ${MODEL_LABEL_MAP.get(item.usage.target)}`
        : item.status === "ready"
          ? "On-device analysis"
          : `Analyzing with ${MODEL_LABEL_MAP.get(item.analysisTarget ?? targetModel)}`;
    if (item.kind === "video") return `First-frame visual reference · ${model}`;
    if (item.kind === "audio") return "Audio file metadata only";
    return model;
  }

  const detailsItem = items.find((it) => it.id === detailsFor) ?? null;
  const roleItem = items.find((it) => it.id === roleFor) ?? null;
  const generateItem = items.find((it) => it.id === generateFor) ?? null;

  return (
    <div className="border-t border-hair">
      {/* Attachment rows. */}
      {items.length > 0 && (
        <ul className="flex flex-col divide-y divide-hair px-3">
          {items.map((item) => (
            <li key={item.id} className="flex flex-col gap-1.5 py-2.5">
              <div className="flex items-center gap-2.5">
                {item.thumbUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={item.thumbUrl}
                    alt=""
                    className="h-10 w-10 shrink-0 rounded-lg object-cover"
                  />
                ) : (
                  <span
                    aria-hidden="true"
                    className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-surface text-base"
                  >
                    {KIND_GLYPH[item.kind]}
                  </span>
                )}
                <div className="min-w-0 flex-1">
                  <p className="font-body truncate text-sm text-text">
                    {sanitizeName(item.name)}
                  </p>
                  <p className="font-body truncate text-[0.6875rem] text-silver">
                    {destinationLine(item)} ·{" "}
                    {item.ephemeral ? "Not stored" : "Stored · counts toward 50 MB"}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setRoleFor(item.id)}
                  className="tap-44 font-body shrink-0 rounded-full border border-hair bg-surface px-2.5 py-1 text-xs text-text transition-colors hover-hair"
                >
                  {ROLE_META[item.role].label} <span aria-hidden="true">▾</span>
                </button>
                <button
                  type="button"
                  onClick={() => void removeItem(item)}
                  aria-label={`Remove ${sanitizeName(item.name)}`}
                  className="-my-1 flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-silver transition-colors hover:text-flare"
                >
                  <svg aria-hidden="true" viewBox="0 0 24 24" className="h-4 w-4">
                    <path
                      d="M6 6l12 12M18 6L6 18"
                      stroke="currentColor"
                      strokeWidth="1.5"
                      strokeLinecap="round"
                    />
                  </svg>
                </button>
              </div>

              {["queued", "reserving", "uploading", "analyzing"].includes(
                item.status,
              ) && (
                <StreamProgress
                  indeterminate
                  step={itemStepLabel(
                    item,
                    MODEL_LABEL_MAP.get(item.analysisTarget ?? targetModel) ??
                      "the model",
                  )}
                />
              )}

              {item.status === "error" && (
                <p className="font-body text-xs text-flare" role="alert">
                  {item.error}
                </p>
              )}
              {item.status === "ready" && item.error && (
                <p className="font-body text-xs text-amber" role="status">
                  {item.error}
                </p>
              )}

              {item.status === "ready" && (
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setDetailsFor(item.id)}
                    className="tap-44 font-body text-xs text-accent transition-colors hover:text-chalk"
                  >
                    Details
                  </button>
                  {item.role === "generate" && (
                    <button
                      type="button"
                      onClick={() => setGenerateFor(item.id)}
                      className="tap-44 font-body text-xs text-accent transition-colors hover:text-chalk"
                    >
                      Generation prompt
                    </button>
                  )}
                  {item.inserted && (
                    <span className="font-body text-xs text-accent">✓ In prompt</span>
                  )}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      {notice && (
        <p className="font-body px-3 pt-2 text-xs text-flare" role="alert">
          {notice}
        </p>
      )}
      {capUsage && capUsage.todayCost >= capUsage.capUsd * 0.8 && (
        <p
          className="font-body px-3 pt-2 text-center text-xs tabular-nums text-amber"
          role="status"
        >
          ⚠ ${capUsage.todayCost.toFixed(2)} of ${capUsage.capUsd.toFixed(2)} daily cap
          used
        </p>
      )}

      {/* Attach rail — the upload affordance, its help, and the storage dial.
          The capability blurb used to sit under the rail as a permanent
          two-line paragraph, which forced the attach control down to a bare
          12px text link that no longer read as "upload a file". The words now
          live behind the rail's `?`, which buys the button back its size: a
          real bordered pill with an upload mark at the rails' `text-sm`. The
          panel is IN FLOW rather than floating — the composer chassis is
          `overflow-hidden`, and an absolutely-positioned tooltip would be
          clipped by it (the same constraint the paste affordance is under). */}
      <input
        ref={fileInput}
        type="file"
        accept="image/*,video/*,audio/*"
        multiple
        className="hidden"
        onChange={(e) => {
          if (e.target.files?.length) onPick(e.target.files);
          e.target.value = "";
        }}
      />
      <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1 px-3 py-2">
        <div className="flex min-w-0 items-center gap-0.5">
          <button
            type="button"
            onClick={() => fileInput.current?.click()}
            disabled={busy || (!budget.over ? false : mediaStoreByDefault)}
            className="glass pill font-body inline-flex min-h-[44px] items-center gap-2 px-3.5 py-1.5 text-left text-sm text-text transition-colors hover-hair disabled:opacity-50"
          >
            <UploadGlyph className="h-4 w-4 shrink-0 text-accent" />
            {busy
              ? "Working through your files…"
              : budget.over && mediaStoreByDefault
                ? "Storage full — remove media below"
                : "Attach media"}
          </button>
          <button
            type="button"
            onClick={() => setHelpOpen((v) => !v)}
            // Escape closes it from the button that opened it — focus never
            // leaves here, since the panel holds no controls of its own.
            onKeyDown={(e) => {
              if (e.key === "Escape" && helpOpen) {
                e.stopPropagation();
                setHelpOpen(false);
              }
            }}
            aria-expanded={helpOpen}
            aria-controls={helpId}
            aria-label="What happens to attached media?"
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-silver transition-colors hover:text-chalk"
          >
            <span
              aria-hidden="true"
              className="font-body flex h-[1.125rem] w-[1.125rem] items-center justify-center rounded-full border border-hair text-[0.625rem] leading-none"
            >
              ?
            </span>
          </button>
        </div>
        {/* The storage dial stays a real toggle but gets quieter: it reports a
            standing preference and must not compete with the action beside it.
            Sentence case, NOT the rails' micro-caps — that register belongs to
            the captions (TARGET · THINKING), and borrowing it here would make a
            control read as a label. */}
        <button
          type="button"
          onClick={() => setMediaStoreByDefault(!mediaStoreByDefault)}
          aria-pressed={mediaStoreByDefault}
          className="tap-44 font-body shrink-0 text-[0.625rem] text-silver transition-colors hover:text-chalk"
        >
          Originals{" "}
          <span className="text-text">{mediaStoreByDefault ? "stored" : "not kept"}</span>
        </button>
      </div>
      {helpOpen && (
        <p
          id={helpId}
          className="font-body mx-3 mb-2 rounded-xl border border-hair bg-surface px-3 py-2 text-[0.6875rem] leading-snug text-silver"
        >
          Images are analyzed; video contributes its first frame; audio contributes
          file metadata only.
        </p>
      )}

      {/* Storage manager surfaces here as the budget tightens (it is always
          available in Settings → Data & privacy). */}
      {budget.warn && (
        <div className="px-3 pb-3">
          <MediaManager onChanged={loadUsage} />
        </div>
      )}

      {/* Role picker. */}
      {roleItem && (
        <Sheet
          open
          onClose={() => setRoleFor(null)}
          title={`Role — ${sanitizeName(roleItem.name, 24)}`}
        >
          <ul className="flex flex-col gap-1">
            {(Object.keys(ROLE_META) as AttachmentRole[]).map((role) => {
              const allowed = rolesForKind(roleItem.kind).includes(role);
              const active = roleItem.role === role;
              return (
                <li key={role}>
                  <button
                    type="button"
                    disabled={!allowed}
                    aria-pressed={active}
                    onClick={() => changeRole(roleItem, role)}
                    className={`flex w-full flex-col items-start gap-0.5 rounded-xl px-3 py-2.5 text-left transition-colors ${
                      active ? "bg-laser text-on-laser" : "glass text-text hover-hair"
                    } disabled:opacity-40`}
                  >
                    <span className="font-body text-sm font-medium">
                      {ROLE_META[role].label}
                    </span>
                    <span
                      className={`font-body text-xs ${active ? "text-on-laser" : "text-silver"}`}
                    >
                      {allowed
                        ? ROLE_META[role].blurb
                        : roleItem.kind === "audio"
                          ? "Not available for audio — only file metadata is read."
                          : "Not available for this file type."}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </Sheet>
      )}

      {detailsItem && (
        <AttachmentDetailsSheet
          item={detailsItem}
          onClose={() => setDetailsFor(null)}
          onInsert={insertText}
          onOpenGenerate={(id) => {
            setDetailsFor(null);
            setGenerateFor(id);
          }}
        />
      )}

      {generateItem && generateItem.attrs && (
        <GenerateSheet
          item={generateItem}
          onClose={() => setGenerateFor(null)}
          onEngineChange={(engine) => patch(generateItem.id, { genTarget: engine })}
        />
      )}

      <MediaPrivacySheet
        open={privacyOpen}
        modelLabel={MODEL_LABEL_MAP.get(targetModel) ?? "your selected model"}
        onClose={() => {
          setPrivacyOpen(false);
          pendingFiles.current = null;
        }}
        onChoose={(store) => {
          setPrivacyOpen(false);
          setMediaNoticeAcknowledged(true);
          setMediaStoreByDefault(store);
          const files = pendingFiles.current;
          pendingFiles.current = null;
          if (files) void proceed(files, !store);
        }}
      />
    </div>
  );
}
