"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { MODES, type ModeId, type TargetModelId } from "@/lib/constants";
import { diffWords, countChanges, type DiffSegment } from "@/lib/enhance/diff";
import { relativeTime } from "@/lib/library/util";
import { useEnhance } from "@/lib/enhance/use-enhance";
import {
  addVersionAction,
  restoreVersionAction,
  deletePromptAction,
} from "@/lib/library/actions";

interface Version {
  id: string;
  input_text: string;
  output_text: string;
  rationale: string | null;
  mode: ModeId;
  model_used: string;
  token_in: number;
  token_out: number;
  created_at: string;
  parent_ver: string | null;
}

interface PromptHead {
  id: string;
  title: string;
  target_model: string;
  tags: string[];
  current_ver: string | null;
}

export function PromptDetail({
  prompt,
  versions,
}: {
  prompt: PromptHead;
  versions: Version[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const target = prompt.target_model as TargetModelId;

  // Newest first for display; keep a label v1..vN by chronological order.
  const labelOf = useMemo(() => {
    const m = new Map<string, number>();
    versions.forEach((v, i) => m.set(v.id, i + 1));
    return m;
  }, [versions]);
  const ordered = useMemo(() => [...versions].reverse(), [versions]);

  const currentId = prompt.current_ver ?? versions[versions.length - 1]?.id ?? null;

  // Diff-any-two: default to current vs its parent (or the previous version).
  const current =
    versions.find((v) => v.id === currentId) ?? versions[versions.length - 1];
  const defaultB = current?.id ?? "";
  const defaultA = current?.parent_ver ?? versions[versions.length - 2]?.id ?? defaultB;
  const [aId, setAId] = useState(defaultA);
  const [bId, setBId] = useState(defaultB);
  const a = versions.find((v) => v.id === aId);
  const b = versions.find((v) => v.id === bId);
  const segments: DiffSegment[] = a && b ? diffWords(a.output_text, b.output_text) : [];

  // Revise → re-enhance → append a new version.
  const [draft, setDraft] = useState(current?.input_text ?? "");
  const [mode, setMode] = useState<ModeId>(current?.mode ?? "clarify");
  const enhanceMutation = useEnhance();
  const revised = enhanceMutation.data;

  function saveVersion() {
    if (!revised) return;
    startTransition(async () => {
      const res = await addVersionAction(prompt.id, {
        input: draft.trim(),
        output: revised.output,
        rationale: revised.rationale,
        mode,
        target,
        modelUsed: revised.modelUsed,
        tokenIn: revised.tokenIn,
        tokenOut: revised.tokenOut,
      });
      if (res.ok) {
        enhanceMutation.reset();
        router.refresh();
      }
    });
  }

  function restore(id: string) {
    startTransition(async () => {
      await restoreVersionAction(prompt.id, id);
      router.refresh();
    });
  }

  function remove() {
    if (!confirm("Delete this prompt and all its versions?")) return;
    startTransition(async () => {
      const res = await deletePromptAction(prompt.id);
      if (res.ok) router.push("/library");
    });
  }

  return (
    <div className="flex flex-col gap-6">
      <header>
        <h1 className="font-display text-2xl tracking-wide text-text">{prompt.title}</h1>
        <p className="font-body mt-1 text-xs text-silver">
          {versions.length} version{versions.length === 1 ? "" : "s"}
          {prompt.tags.length ? ` · ${prompt.tags.map((t) => `#${t}`).join(" ")}` : ""}
        </p>
      </header>

      {/* Diff any two versions. */}
      {versions.length >= 1 && (
        <section className="flex flex-col gap-3" aria-label="Compare versions">
          <div className="flex items-center gap-2">
            <VersionSelect
              value={aId}
              onChange={setAId}
              versions={versions}
              labelOf={labelOf}
            />
            <span className="font-body text-xs text-silver">→</span>
            <VersionSelect
              value={bId}
              onChange={setBId}
              versions={versions}
              labelOf={labelOf}
            />
            <span className="font-body ml-auto text-xs text-accent">
              {countChanges(segments)} change{countChanges(segments) === 1 ? "" : "s"}
            </span>
          </div>
          <div className="glass rounded-2xl p-4">
            <p className="mono whitespace-pre-wrap break-words text-sm text-chalk">
              {segments.map((seg, i) =>
                seg.op === "removed" ? (
                  <span key={i} className="text-flare/70 line-through">
                    {seg.text}
                  </span>
                ) : (
                  <span key={i} className={seg.op === "added" ? "text-accent" : undefined}>
                    {seg.text}
                  </span>
                ),
              )}
            </p>
          </div>
        </section>
      )}

      {/* Version history. */}
      <section aria-label="Version history">
        <h2 className="font-body mb-2 text-xs uppercase tracking-wider text-silver">
          History
        </h2>
        <ul className="glass flex flex-col divide-y divide-hair rounded-2xl">
          {ordered.map((v) => (
            <li key={v.id} className="flex items-center justify-between gap-3 px-4 py-3">
              <div className="min-w-0">
                <p className="font-body text-sm text-text">
                  v{labelOf.get(v.id)} · {v.mode}
                  {v.id === currentId ? (
                    <span className="font-body ml-2 text-xs text-accent">current</span>
                  ) : null}
                </p>
                <p className="font-body truncate text-xs text-silver">
                  {relativeTime(v.created_at)} · {v.model_used}
                </p>
              </div>
              {v.id !== currentId && (
                <button
                  type="button"
                  onClick={() => restore(v.id)}
                  disabled={pending}
                  className="glass font-body shrink-0 rounded-lg px-3 py-1.5 text-xs text-text disabled:opacity-60"
                >
                  Restore
                </button>
              )}
            </li>
          ))}
        </ul>
      </section>

      {/* Revise → re-enhance → save as a new version. */}
      <section className="flex flex-col gap-3" aria-label="Revise">
        <h2 className="font-body text-xs uppercase tracking-wider text-silver">Revise</h2>
        <div className="-mx-1 flex flex-wrap gap-2 px-1">
          {MODES.map((m) => (
            <button
              key={m.id}
              type="button"
              onClick={() => setMode(m.id)}
              className={[
                "font-body rounded-full px-3 py-1.5 text-xs uppercase tracking-wider transition-colors",
                mode === m.id
                  ? "bg-laser text-on-laser"
                  : "glass text-silver hover:text-chalk",
              ].join(" ")}
            >
              {m.label}
            </button>
          ))}
        </div>
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          rows={5}
          className="glass font-body w-full resize-y rounded-xl bg-transparent p-3 text-sm text-text focus:outline-none"
        />
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => enhanceMutation.mutate({ input: draft.trim(), mode, target })}
            disabled={enhanceMutation.isPending || draft.trim() === ""}
            className="btn-laser min-h-[44px] rounded-xl px-4 text-sm disabled:opacity-60"
          >
            {enhanceMutation.isPending ? "Enhancing…" : "► Re-enhance"}
          </button>
          {revised && (
            <button
              type="button"
              onClick={saveVersion}
              disabled={pending}
              className="glass min-h-[44px] rounded-xl px-4 text-sm text-text disabled:opacity-60"
            >
              {pending ? "Saving…" : "Save as new version"}
            </button>
          )}
          <button
            type="button"
            onClick={remove}
            disabled={pending}
            className="glass ml-auto min-h-[44px] rounded-xl px-4 text-sm text-flare disabled:opacity-60"
          >
            Delete
          </button>
        </div>
        {enhanceMutation.isError && (
          <p className="font-body text-sm text-flare" role="alert">
            {enhanceMutation.error.notConfigured
              ? "This model isn't configured yet — add its API key on the server."
              : enhanceMutation.error.message}
          </p>
        )}
        {revised && (
          <div className="glass rounded-2xl p-4">
            <p className="font-body mb-2 text-xs uppercase tracking-wider text-silver">
              Re-enhanced preview
            </p>
            {/* OUTPUT REGION: re-enhanced result body in mono (JetBrains). */}
            <p className="mono whitespace-pre-wrap break-words text-sm text-chalk">
              {revised.output}
            </p>
          </div>
        )}
      </section>
    </div>
  );
}

function VersionSelect({
  value,
  onChange,
  versions,
  labelOf,
}: {
  value: string;
  onChange: (id: string) => void;
  versions: Version[];
  labelOf: Map<string, number>;
}) {
  return (
    <div className="glass rounded-lg">
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-label="Version to compare"
        className="font-body rounded-lg bg-transparent px-2 py-1.5 text-xs text-text focus:outline-none"
      >
        {versions.map((v) => (
          <option key={v.id} value={v.id} className="bg-onyx text-chalk">
            v{labelOf.get(v.id)} · {v.mode}
          </option>
        ))}
      </select>
    </div>
  );
}
