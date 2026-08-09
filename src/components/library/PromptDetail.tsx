"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { PressableButton } from "@/components/ui/PressableButton";
import { useRouter } from "next/navigation";
import { MODES, MODE_LABEL, type ModeId, type TargetModelId } from "@/lib/constants";
import { boundedDiffWords, countChangedSections } from "@/lib/enhance/diff";
import { relativeTime, parseTags } from "@/lib/library/util";
import {
  NOT_CONFIGURED_MESSAGE,
  useEnhance,
  type EnhanceResponse,
} from "@/lib/enhance/use-enhance";
import { useToast } from "@/components/ui/Toast";
import { useCopy } from "@/components/ui/use-copy";
import { StreamingResult } from "@/components/diff/StreamingResult";
import { PartialOutput } from "@/components/diff/PartialOutput";
import { ComparisonSegments } from "@/components/diff/segments";
import { Skeleton } from "@/components/ui/Skeleton";
import {
  addVersionAction,
  restoreVersionAction,
  softDeletePromptAction,
  undoDeletePromptAction,
  updateTagsAction,
  getVersionBodyAction,
  type VersionBody,
} from "@/lib/library/actions";

/** Version metadata — bodies (input/output/rationale) load lazily. */
interface VersionMeta {
  id: string;
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
  initialBodies,
}: {
  prompt: PromptHead;
  versions: VersionMeta[];
  initialBodies: VersionBody[];
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [pending, startTransition] = useTransition();
  // Server-action failures were previously swallowed, then funnelled into a
  // single line at the bottom of the Revise section — which put a failed
  // Restore's only feedback ~700px below the button that caused it (audit
  // VAR-23). Each section now owns the errors its controls raise: tags at the
  // top, history beside Restore, and the original slot keeps revise/save/
  // delete.
  const [actionError, setActionError] = useState<string | null>(null);
  const [tagError, setTagError] = useState<string | null>(null);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const target = prompt.target_model as TargetModelId;

  // Lazy version bodies: seeded with the server-shipped compare pair, grown
  // on demand as the selects (or history) touch other versions.
  const [bodies, setBodies] = useState<ReadonlyMap<string, VersionBody>>(
    () => new Map(initialBodies.map((b) => [b.id, b])),
  );
  const [loadingBodies, setLoadingBodies] = useState<ReadonlySet<string>>(new Set());
  useEffect(() => {
    // router.refresh() after a save ships fresh seed bodies — merge them in.
    setBodies((prev) => {
      const next = new Map(prev);
      for (const b of initialBodies) next.set(b.id, b);
      return next;
    });
  }, [initialBodies]);

  const ensureBody = useCallback(
    (versionId: string | null | undefined) => {
      if (!versionId || bodies.has(versionId) || loadingBodies.has(versionId)) return;
      setLoadingBodies((prev) => new Set(prev).add(versionId));
      void getVersionBodyAction(prompt.id, versionId).then((res) => {
        setLoadingBodies((prev) => {
          const next = new Set(prev);
          next.delete(versionId);
          return next;
        });
        if (res.ok && res.body) {
          const body = res.body;
          setBodies((prev) => new Map(prev).set(body.id, body));
        } else {
          setHistoryError(res.error ?? "Couldn't load that version.");
        }
      });
    },
    [bodies, loadingBodies, prompt.id],
  );

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

  // The revise editor seeds from the current version's OUTPUT (2026-07 UX
  // audit: revision iterates on the result, not the original input).
  const currentBody = currentId ? bodies.get(currentId) : undefined;
  const [draft, setDraft] = useState(currentBody?.output_text ?? "");
  const [mode, setMode] = useState<ModeId>(current?.mode ?? "clarify");
  const enhanceMutation = useEnhance();

  // The R8 request snapshot (mirrors EnhanceComposer): Save reads ONLY what
  // was actually submitted — editing the draft or flipping a mode pill after
  // a run can never relabel the stored version.
  const [reviseView, setReviseView] = useState<{
    submitted: { input: string; mode: ModeId; target: TargetModelId };
    result: EnhanceResponse;
  } | null>(null);
  const revised = reviseView?.result ?? null;
  const reviseStale =
    reviseView !== null &&
    (draft.trim() !== reviseView.submitted.input || mode !== reviseView.submitted.mode);

  // Re-seed the compare selects AND the revise editor whenever the CURRENT
  // version moves (save-as-new-version, restore): router.refresh() delivers
  // new props to the same client instance, so state seeded at first render
  // would keep labeling a superseded version as the current output.
  const seededFor = useRef(currentId);
  useEffect(() => {
    if (seededFor.current === currentId || !currentId) return;
    seededFor.current = currentId;
    const cur = versions.find((v) => v.id === currentId);
    setBId(currentId);
    setAId(cur?.parent_ver ?? currentId);
    setDraft(bodies.get(currentId)?.output_text ?? "");
    setMode(cur?.mode ?? "clarify");
    setReviseView(null);
  }, [currentId, versions, bodies]);

  // Compare bodies load on demand as the selects move.
  useEffect(() => ensureBody(aId), [aId, ensureBody]);
  useEffect(() => ensureBody(bId), [bId, ensureBody]);

  const aBody = bodies.get(aId);
  const bBody = bodies.get(bId);
  const compareLoading =
    (!aBody && loadingBodies.has(aId)) || (!bBody && loadingBodies.has(bId));

  // Bounded + memoized: the old unbounded call re-ran the O(n·m) LCS on
  // every keystroke in the revise textarea. `null` = too long to diff.
  const segments = useMemo(
    () => (aBody && bBody ? boundedDiffWords(aBody.output_text, bBody.output_text) : []),
    [aBody, bBody],
  );

  const { copied, copy } = useCopy();

  async function copyCurrent() {
    const text = (bBody ?? currentBody)?.output_text;
    if (!text) return;
    await copy(text);
  }

  function runRevise() {
    const input = draft.trim();
    if (!input) return;
    const submitted = { input, mode, target };
    setReviseView(null);
    enhanceMutation.mutate(submitted, {
      // mutate-level callbacks fire only for the latest call — a stale run
      // can never overwrite a newer snapshot.
      onSuccess: (result) => setReviseView({ submitted, result }),
    });
  }

  function saveVersion() {
    // Save persists the SNAPSHOT tied to the run — never live editor state.
    if (!reviseView) return;
    const v = reviseView;
    setActionError(null);
    startTransition(async () => {
      const res = await addVersionAction(prompt.id, {
        input: v.submitted.input,
        output: v.result.output,
        rationale: v.result.rationale,
        mode: v.submitted.mode,
        target: v.submitted.target,
        modelUsed: v.result.modelUsed,
        tokenIn: v.result.tokenIn,
        tokenOut: v.result.tokenOut,
      });
      if (res.ok) {
        enhanceMutation.reset();
        setReviseView(null);
        router.refresh();
      } else {
        setActionError(res.error ?? "Couldn't save the new version.");
      }
    });
  }

  function restore(id: string) {
    setHistoryError(null);
    startTransition(async () => {
      const res = await restoreVersionAction(prompt.id, id);
      if (res.ok) router.refresh();
      else setHistoryError(res.error ?? "Couldn't restore that version.");
    });
  }

  function remove() {
    // Soft delete + Undo toast (2026-07 UX audit) — no blocking confirm, no
    // irreversible cascade from the everyday delete path.
    setActionError(null);
    const id = prompt.id;
    startTransition(async () => {
      const res = await softDeletePromptAction(id);
      if (!res.ok) {
        setActionError(res.error ?? "Couldn't delete the prompt.");
        return;
      }
      router.push("/library");
      toast({
        text: "Prompt deleted",
        action: {
          label: "Undo",
          onAction: () => {
            void undoDeletePromptAction(id).then(() => router.refresh());
          },
        },
      });
    });
  }

  return (
    <div className="flex flex-col gap-6">
      <header>
        {/* h2: the ScreenHeader already carries the screen's h1 ("Prompt"). */}
        <h2 className="font-display break-words text-balance text-2xl tracking-wide text-text">
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
        onError={setTagError}
        onSaved={() => router.refresh()}
      />
      {tagError && (
        <p className="font-body text-sm text-flare" role="alert">
          {tagError}
        </p>
      )}

      {/* Current output — the reason the prompt was saved; copy is the primary
          "use it" action and lives where the eyes are. */}
      <section className="flex flex-col gap-3" aria-label="Current output">
        {versions.length >= 2 && (
          // flex-wrap: with two selects + the changed-sections readout the
          // rail overflows a 320px viewport and pans the whole page (audit
          // VAR-21) — wrapping drops the readout to its own line instead.
          <div className="flex flex-wrap items-center gap-2">
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
              {segments === null
                ? "too long to diff"
                : `${countChangedSections(segments)} changed section${
                    countChangedSections(segments) === 1 ? "" : "s"
                  }`}
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
            <PressableButton
                            onClick={copyCurrent}
              aria-label={copied ? "Copied" : "Copy prompt text"}
              className="-my-2 -mr-1.5 flex h-11 w-11 items-center justify-center rounded-full text-silver hover:text-chalk focus-visible:text-chalk"
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
            </PressableButton>
          </div>
          {compareLoading ? (
            /* A shape where the version body will land, so the panel doesn't
               collapse and re-expand as it arrives. */
            <div role="status" aria-label="Loading version">
              <Skeleton lines={4} />
            </div>
          ) : (
            /* OUTPUT REGION: prompt/diff body renders in mono (JetBrains). */
            <p className="mono whitespace-pre-wrap break-words text-sm text-chalk">
              {versions.length >= 2 && segments && segments.length > 0 ? (
                <ComparisonSegments segments={segments} />
              ) : (
                <>{(bBody ?? currentBody)?.output_text}</>
              )}
            </p>
          )}
          {segments === null && (
            <p className="font-body mt-2 text-xs text-silver" role="status">
              These versions are too long to diff — showing the selected version.
            </p>
          )}
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
                  v{labelOf.get(v.id)} · {MODE_LABEL[v.mode] ?? v.mode}
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
                  className="glass font-body -my-1 min-h-[44px] shrink-0 rounded-xl px-3 text-xs text-text hover-hair transition-colors disabled:opacity-60"
                >
                  Restore
                </button>
              )}
            </li>
          ))}
        </ul>
        {historyError && (
          <p className="font-body mt-2 text-sm text-flare" role="alert">
            {historyError}
          </p>
        )}
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
                // tap-44 extends the hit box to 44pt without touching the
                // compact pill visual.
                "tap-44 font-body rounded-full px-3 py-1.5 text-xs uppercase tracking-wider transition-colors",
                mode === m.id
                  ? "selected-ink bg-laser text-on-laser"
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
          className="glass font-body w-full resize-y rounded-xl bg-transparent p-3 text-base text-text focus:outline-none"
        />
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={runRevise}
            disabled={enhanceMutation.isPending || draft.trim() === ""}
            className="btn-laser min-h-[44px] rounded-xl px-4 text-sm"
          >
            {enhanceMutation.isPending ? (
              <>
                <span className="spinner" aria-hidden="true" /> Enhancing…
              </>
            ) : (
              "► RE-ENHANCE"
            )}
          </button>
          {revised && (
            <button
              type="button"
              onClick={saveVersion}
              disabled={pending}
              className="glass min-h-[44px] rounded-xl px-4 text-sm text-text hover-hair transition-colors disabled:opacity-60"
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
          <>
            <p className="font-body text-sm text-flare" role="alert">
              {enhanceMutation.error.notConfigured
                ? NOT_CONFIGURED_MESSAGE
                : enhanceMutation.error.message}
            </p>
            {/* Same as the composer: text that already streamed survives a
                mid-run failure as an actionable card — suppressed while a
                finished preview is still rendered (that result is the better
                recovery material). Use-as-draft seeds the revise textarea. */}
            {!revised && enhanceMutation.stream.partialOutput && (
              <PartialOutput
                text={enhanceMutation.stream.partialOutput}
                onUse={(t) => setDraft(t)}
              />
            )}
          </>
        )}
        {/* Live stream surface while the re-enhance is in flight — the same
            footprint the finished preview replaces (parity with the composer;
            the streaming machinery was already wired, just never rendered
            here). */}
        {(enhanceMutation.stream.active || enhanceMutation.isPending) && !revised && (
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
            {/* Editing the draft or flipping the mode after the run doesn't
                change what Save stores — label the mismatch honestly. */}
            {reviseStale && (
              <p className="font-body mb-2 text-xs text-amber-ink" role="status">
                Result from previous settings — re-enhance to match your edits.
                Saving keeps the settings this result actually came from.
              </p>
            )}
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
    const prev = localTags;
    setLocalTags(next);
    startSave(async () => {
      try {
        const res = await updateTagsAction(promptId, next);
        if (res.ok) onSaved();
        else {
          setLocalTags(prev); // roll the optimistic update back
          onError(res.error ?? "Couldn't update tags.");
        }
      } catch {
        // A network-level throw inside a React 19 async transition would
        // otherwise escape to the route error boundary; keep it local.
        setLocalTags(prev);
        onError("Couldn't update tags — check your connection.");
      }
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
            className="tap-44 -my-2 flex h-8 w-8 items-center justify-center rounded-full transition-colors hover:text-chalk disabled:opacity-60"
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
        // Tags normalize to lowercase slugs — keep the iOS keyboard from
        // capitalizing or autocorrecting them; return reads "done".
        enterKeyHint="done"
        autoCapitalize="none"
        autoCorrect="off"
        spellCheck={false}
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
  versions: VersionMeta[];
  labelOf: Map<string, number>;
  label: string;
}) {
  return (
    <div className="glass rounded-xl">
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-label={label}
        className="font-body min-h-[44px] rounded-xl bg-transparent px-2 py-2 text-xs text-text focus:outline-none"
      >
        {versions.map((v) => (
          <option key={v.id} value={v.id} className="bg-onyx text-chalk">
            v{labelOf.get(v.id)} · {MODE_LABEL[v.mode] ?? v.mode}
          </option>
        ))}
      </select>
    </div>
  );
}
