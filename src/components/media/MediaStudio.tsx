"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { useUIStore } from "@/stores/ui";
import { kindForMime, extractOnDevice, captureFrameDataUrl } from "@/lib/media/ondevice";
import { buildGenerationPrompt, budgetStatus, formatBytes } from "@/lib/media/formatters";
import {
  GEN_TARGETS,
  DEFAULT_GEN_TARGET,
  type GenTargetId,
  type MediaAttributes,
  type MediaKind,
} from "@/lib/media/types";
import { savePromptAction } from "@/lib/library/actions";
import type { Json } from "@/lib/supabase/database.types";

/** Extraction pipeline flag (locked default: proxy, with on-device fallback). */
const EXTRACTION =
  process.env.NEXT_PUBLIC_MEDIA_EXTRACTION === "ondevice" ? "ondevice" : "proxy";

type Status = "idle" | "uploading" | "extracting" | "ready" | "error";

export function MediaStudio() {
  const targetModel = useUIStore((s) => s.targetModel);
  const editorDraft = useUIStore((s) => s.editorDraft);
  const fileInput = useRef<HTMLInputElement>(null);

  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState<string | null>(null);
  const [kind, setKind] = useState<MediaKind | null>(null);
  const [attrs, setAttrs] = useState<MediaAttributes | null>(null);
  const [refUrl, setRefUrl] = useState<string | undefined>(undefined);
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

  const budget = budgetStatus(usedBytes);

  const generated = useMemo(() => {
    if (!attrs) return "";
    const base = (basePrompt || editorDraft || "").trim();
    return buildGenerationPrompt(base, attrs, genTarget, refUrl);
  }, [attrs, basePrompt, editorDraft, genTarget, refUrl]);

  async function onFile(file: File) {
    setError(null);
    setSavedId(null);
    const k = kindForMime(file.type);
    if (!k) {
      setError("Unsupported file type.");
      setStatus("error");
      return;
    }
    setKind(k);
    setGenTarget(DEFAULT_GEN_TARGET[k]);

    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      setError("Sign in to attach media.");
      setStatus("error");
      return;
    }

    // Upload to the private media bucket under the owner's prefix.
    setStatus("uploading");
    const ext = file.name.split(".").pop() ?? "bin";
    const path = `${user.id}/${crypto.randomUUID()}.${ext}`;
    const { error: upErr } = await supabase.storage
      .from("media")
      .upload(path, file, { contentType: file.type, upsert: false });
    if (upErr) {
      setError(upErr.message);
      setStatus("error");
      return;
    }
    setUsedBytes((b) => b + file.size);

    const { data: asset, error: insErr } = await supabase
      .from("media_assets")
      .insert({ user_id: user.id, storage_path: path, kind: k, size_bytes: file.size })
      .select("id")
      .single();
    if (insErr || !asset) {
      setError(insErr?.message ?? "Couldn't record the asset.");
      setStatus("error");
      return;
    }

    const { data: signed } = await supabase.storage
      .from("media")
      .createSignedUrl(path, 60 * 60 * 24 * 7);
    setRefUrl(signed?.signedUrl);

    // Extract — proxy by default (image/video frame), on-device fallback/audio.
    setStatus("extracting");
    const onDevice = await extractOnDevice(file, k);
    let merged: MediaAttributes = onDevice;

    if (EXTRACTION === "proxy" && k !== "audio") {
      const dataUrl = await captureFrameDataUrl(file, k);
      if (dataUrl) {
        try {
          const res = await fetch("/api/media", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ dataUrl }),
          });
          const data = await res.json().catch(() => ({}));
          if (res.ok && data.attributes) {
            merged = { ...onDevice, ...data.attributes, source: "proxy" };
          } else if (data.notConfigured) {
            setError("Vision extraction isn't configured — used on-device analysis.");
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
    setAttrs(merged);
    setStatus("ready");
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

  const busy = status === "uploading" || status === "extracting";
  const targets = GEN_TARGETS.filter((t) => !kind || t.kind === kind);

  return (
    <section className="flex flex-col gap-4" aria-label="Media to generation prompt">
      <div className="flex items-center justify-between">
        <h2 className="font-display text-xl tracking-wide text-text">Media reference</h2>
        {budget.warn && (
          <span className="font-body text-xs text-amber">
            ⚠ {formatBytes(budget.usedBytes)} / {formatBytes(budget.quotaBytes)}
          </span>
        )}
      </div>

      <input
        ref={fileInput}
        type="file"
        accept="image/*,video/*,audio/*"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void onFile(f);
          e.target.value = "";
        }}
      />
      <button
        type="button"
        onClick={() => fileInput.current?.click()}
        disabled={busy || budget.over}
        className="glass min-h-[48px] rounded-xl px-4 text-sm text-text disabled:opacity-60"
      >
        {status === "uploading"
          ? "Uploading…"
          : status === "extracting"
            ? "Reading the details…"
            : budget.over
              ? "Storage full — remove media to continue"
              : "📎 Attach image, video, or audio"}
      </button>

      {error && (
        <p className="font-body text-sm text-flare" role="alert">
          {error}
        </p>
      )}

      {attrs && (
        <>
          {/* Detected attributes. */}
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
                    <dt className="text-silver/70">{k}</dt>
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
