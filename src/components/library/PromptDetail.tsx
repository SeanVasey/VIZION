"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { MODES, type ModeId, type TargetModelId } from "@/lib/constants";
import { diffWords, countChanges, type DiffSegment } from "@/lib/enhance/diff";
import { relativeTime, parseTags } from "@/lib/library/util";
import { useEnhance } from "@/lib/enhance/use-enhance";
import { StreamingResult } from "@/components/diff/StreamingResult";
import {
  addVersionAction,
  restoreVersionAction,
  deletePromptAction,
  updateTagsAction,
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
  // Server-action failures were previously swallowed — every mutation on this
  // screen reports here.
  const [actionError, setActionError] = useState<string | null>(null);
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

  // Re-seed the compare selects whenever the CURRENT version moves (save-as-
  // new-version, restore): router.refresh() delivers new props to the same
  // client instance, so state seeded at first render would keep labeling a
  // superseded version as the current output (and copy the stale text).
  const seededFor = useRef(currentId);
  useEffect(() => {
    if (seededFor.current === currentId || !currentId) return;
    seededFor.current = currentId;
    const cur = versions.find((v) => v.id === currentId);
    setBId(currentId);
    setAId(cur?.parent_ver ?? currentId);
  }, [currentId, versions]);

  const a = versions.find((v) => v.id === aId);
  const b = versions.find((v) => v.id === bId);
  const segments: DiffSegment[] = a && b ? diffWords(a.output_text, b.output_text) : [];

  const [copied, setCopied] = useState(false);

  // Revise → re-enhance → append a new version.
  const [draft, setDraft] = useState(current?.input_text ?? "");
  const [mode, setMode] = useState<ModeId>(current?.mode ?? "clarify");
  const enhanceMutation = useEnhance();
  const revised = enhanceMutation.data;

  async function copyCurrent() {
    const text = (b ?? current)?.output_text;
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard unavailable; no-op */
    }
  }

  function saveVersion() {
    if (!revised) return;
    setActionError(null);
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
      } else {
        setActionError(res.error ?? "Couldn't save the new version.");
      }
    });
  }

  function restore(id: string) {
    setActionError(null);
    startTransition(async () => {
      const res = await restoreVersionAction(prompt.id, id);
      if (res.ok) router.refresh();
      else setActionError(res.error ?? "Couldn't restore that version.");
    });
  }

  function remove() {
    if (!confirm("Delete this prompt and all its versions?")) return;
    setActionError(null);
    startTransition(async () => {
      const res = await deletePromptAction(prompt.id);
      if (res.ok) router.push("/library");
      else setActionError(res.error ?? "Couldn't delete the prompt.");
    });
  }

  return (
    <div className="flex flex-col gap-6">
      <header>
        {/* h2: the ScreenHeader already carries the screen's h1 ("Prompt"). */}
        <h2 className="font-display text-balance text-2xl tracking-wide text-text">
          {prompt.title}
        </h2>
        <p className="font-body mt-1 text-xs tabular-nums text-silver">
          {versions.length} version{versions.length === 1 ? "" : "s"}
        </p>
      </header>

      {/* Tags — the filterable labels the library browser keys on. */}
      <TagEditor
        promptId={prompt.id}
        tags={prompt.tags}
        disabled={pending}
        onError={setActionError}
        onSaved={() => router.refresh()}
      />

      {/* Current output — the reason the prompt was saved; copy is the primary
          "use it" action and lives where the eyes are. */}
      <section className="flex flex-col gap-3" aria-label="Current output">
        {versions.length >= 2 && (
          <div className="flex items-center gap-2">
            <VersionSelect
              value={aId}
              onChange={setAId}
              versions={versions}
              labelOf={labelOf}
              label="Compare from version"
            />
            <span className="font-body text-xs text-silver" aria-hidden="true">
              →
            </span>
            <VersionSelect
              value={bId}
              onChange={setBId}
              versions={versions}
              labelOf={labelOf}
              label="Compare to version"
            />
            <span className="font-body ml-auto text-xs tabular-nums text-accent">
              {countChanges(segments)} change{countChanges(segments) === 1 ? "" : "s"}
            </span>
          </div>
        )}
        <div className="glass rounded-2xl p-4">
          <div className="mb-2 flex items-center justify-between">
            <p className="font-body text-xs uppercase tracking-wider text-silver">
              {versions.length >= 2
                ? `v${labelOf.get(aId) ?? "?"} → v${labelOf.get(bId) ?? "?"}`
                : `v${labelOf.get(currentId ?? "") ?? 1}`}
            </p>
            {/* Quick copy — 44px tap target that doesn't inflate the header row. */}
            <button
              type="button"
              onClick={copyCurrent}
              aria-label={copied ? "Copied" : "Copy prompt text"}
              className="-my-2 -mr-1.5 flex h-11 w-11 items-center justify-center rounded-full text-silver transition-[color,transform] duration-150 hover:text-chalk focus-visible:text-chalk active:scale-95"
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
          {/* OUTPUT REGION: prompt/diff body renders in mono (JetBrains). */}
          <p className="mono whitespace-pre-wrap break-words text-sm text-chalk">
            {versions.length >= 2 ? (
              segments.map((seg, i) =>
                seg.op === "removed" ? (
                  <span key={i} className="text-flare line-through opacity-70">
                    {seg.text}
                  </span>
                ) : (
                  <span key={i} className={seg.op === "added" ? "text-accent" : undefined}>
                    {seg.text}
                  </span>
                ),
              )
            ) : (
              <>{current?.output_text}</>
            )}
          </p>
        </div>
      </section>

      {/* Version history. */}
      <section aria-label="Version history">
        <h3 className="font-body mb-2 text-xs uppercase tracking-wider text-silver">
          History
        </h3>
        <ul className="glass flex flex-col divide-y divide-hair overflow-hidden rounded-2xl">
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
                  className="glass font-body -my-1 min-h-[44px] shrink-0 rounded-xl px-3 text-xs text-text transition-shadow hover:shadow-hair disabled:opacity-60"
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
        <h3 className="font-body text-xs uppercase tracking-wider text-silver">Revise</h3>
        <div className="-mx-1 flex flex-wrap gap-2 px-1">
          {MODES.map((m) => (
            <button
              key={m.id}
              type="button"
              onClick={() => setMode(m.id)}
              aria-pressed={mode === m.id}
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
        <label htmlFor="revise-input" className="sr-only">
          Prompt to revise
        </label>
        <textarea
          id="revise-input"
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
              className="glass min-h-[44px] rounded-xl px-4 text-sm text-text transition-shadow hover:shadow-hair disabled:opacity-60"
            >
              {pending ? "Saving…" : "Save as new version"}
            </button>
          )}
          <button
            type="button"
            onClick={remove}
            disabled={pending}
            className="btn-destructive ml-auto min-h-[44px] px-4 text-sm disabled:opacity-60"
          >
            Delete
          </button>
        </div>
        {actionError && (
          <p className="font-body text-sm text-flare" role="alert">
            {actionError}
          </p>
        )}
        {/* A deliberate cancel (status 0) is not an error the user should read
            — same contract as the composer. */}
        {enhanceMutation.isError && enhanceMutation.error.status !== 0 && (
          <p className="font-body text-sm text-flare" role="alert">
            {enhanceMutation.error.notConfigured
              ? "This model isn't configured yet — add its API key on the server."
              : enhanceMutation.error.message}
          </p>
        )}
        {/* Live stream surface while the re-enhance is in flight — the same
            footprint the finished preview replaces (parity with the composer;
            the streaming machinery was already wired, just never rendered
            here). */}
        {enhanceMutation.stream.active && !revised && (
          <StreamingResult
            step={enhanceMutation.stream.step}
            partialOutput={enhanceMutation.stream.partialOutput}
            tokenIn={enhanceMutation.stream.tokenIn}
            tokenOut={enhanceMutation.stream.tokenOut}
            costUsd={enhanceMutation.stream.costUsd}
          />
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

/**
 * Inline tag editor — the server action (updateTagsAction) and the normaliser
 * (parseTags) existed from P4 but no UI ever invoked them, leaving the library
 * tag filter permanently empty.
 */
function TagEditor({
  promptId,
  tags,
  disabled,
  onError,
  onSaved,
}: {
  promptId: string;
  tags: string[];
  disabled: boolean;
  onError: (message: string | null) => void;
  onSaved: () => void;
}) {
  const [inputValue, setInputValue] = useState("");
  // Optimistic local copy: the `tags` prop is stale until router.refresh()
  // lands, so two quick edits computed from the prop would silently drop the
  // first one — every commit derives from (and immediately updates) this.
  const [localTags, setLocalTags] = useState(tags);
  useEffect(() => setLocalTags(tags), [tags]);
  const [saving, startSave] = useTransition();

  function commit(next: string[]) {
    onError(null);
    setLocalTags(next);
    startSave(async () => {
      const res = await updateTagsAction(promptId, next);
      if (res.ok) onSaved();
      else onError(res.error ?? "Couldn't update tags.");
    });
  }

  function addFromInput() {
    const parsed = parseTags(inputValue);
    if (parsed.length === 0) return;
    setInputValue("");
    const next = Array.from(new Set([...localTags, ...parsed]));
    if (next.length !== localTags.length) commit(next);
  }

  return (
    <div className="flex flex-wrap items-center gap-2" aria-label="Tags">
      {localTags.map((t) => (
        <span
          key={t}
          className="font-body inline-flex items-center gap-1 rounded-full border border-hair bg-surface py-1 pl-3 pr-1 text-xs text-silver"
        >
          #{t}
          <button
            type="button"
            aria-label={`Remove tag ${t}`}
            disabled={disabled || saving}
            onClick={() => commit(localTags.filter((x) => x !== t))}
            className="-my-2 flex h-8 w-8 items-center justify-center rounded-full transition-colors hover:text-chalk disabled:opacity-60"
          >
            <svg aria-hidden="true" viewBox="0 0 24 24" className="h-3 w-3">
              <path
                d="M6 6l12 12M18 6L6 18"
                stroke="currentColor"
                strokeWidth="1.75"
                strokeLinecap="round"
              />
            </svg>
          </button>
        </span>
      ))}
      <label htmlFor="tag-input" className="sr-only">
        Add a tag
      </label>
      <input
        id="tag-input"
        value={inputValue}
        disabled={disabled || saving}
        onChange={(e) => setInputValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === ",") {
            e.preventDefault();
            addFromInput();
          }
        }}
        onBlur={addFromInput}
        placeholder={saving ? "Saving…" : "+ tag"}
        className="font-body w-20 rounded-full border border-hair bg-transparent px-3 py-1 text-xs text-text placeholder:text-muted focus:outline-none disabled:opacity-60"
      />
    </div>
  );
}

function VersionSelect({
  value,
  onChange,
  versions,
  labelOf,
  label,
}: {
  value: string;
  onChange: (id: string) => void;
  versions: Version[];
  labelOf: Map<string, number>;
  label: string;
}) {
  return (
    <div className="glass rounded-xl">
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-label={label}
        className="font-body rounded-xl bg-transparent px-2 py-2 text-xs text-text focus:outline-none"
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
