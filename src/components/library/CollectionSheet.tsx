"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Sheet } from "@/components/ui/Sheet";
import { ConfirmSheet } from "@/components/ui/ConfirmSheet";
import type { CollectionFacet, PromptCard } from "@/lib/library/queries";
import {
  createCollectionAction,
  deleteCollectionAction,
  renameCollectionAction,
  setCollectionAction,
} from "@/lib/library/actions";

/**
 * Move-to-collection sheet (2026-07 deferral, now landing). This sheet IS
 * the collections management surface — no dedicated screen: pick a
 * collection to move the prompt, create one inline, rename or delete per
 * row. Deleting a collection keeps its prompts (the FK releases them).
 */
export function CollectionSheet({
  open,
  onClose,
  prompt,
  collections,
  onMoved,
}: {
  open: boolean;
  onClose: () => void;
  prompt: PromptCard;
  collections: CollectionFacet[];
  /** Called after a successful move/remove — closes the whole action stack. */
  onMoved: () => void;
}) {
  const router = useRouter();
  const [createDraft, setCreateDraft] = useState("");
  const [renaming, setRenaming] = useState<CollectionFacet | null>(null);
  const [renameDraft, setRenameDraft] = useState("");
  const [confirmDelete, setConfirmDelete] = useState<CollectionFacet | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startAction] = useTransition();

  function run(fn: () => Promise<{ ok: boolean; error?: string }>, done?: () => void) {
    setError(null);
    startAction(async () => {
      const res = await fn();
      if (!res.ok) {
        setError(res.error ?? "That didn't stick — try again.");
        return;
      }
      router.refresh();
      done?.();
    });
  }

  function move(collectionId: string | null) {
    run(() => setCollectionAction(prompt.id, collectionId), onMoved);
  }

  function createAndMove() {
    const name = createDraft.trim();
    if (!name) return;
    setError(null);
    startAction(async () => {
      const created = await createCollectionAction(name);
      if (!created.ok || !created.id) {
        setError(created.error ?? "Couldn't create the collection.");
        return;
      }
      const moved = await setCollectionAction(prompt.id, created.id);
      if (!moved.ok) {
        setError(moved.error ?? "Created, but couldn't move the prompt.");
        return;
      }
      setCreateDraft("");
      router.refresh();
      onMoved();
    });
  }

  const rowClass =
    "glass font-body flex min-h-[44px] flex-1 items-center justify-between rounded-xl px-4 text-sm text-text hover-hair transition-colors disabled:opacity-60";
  const iconClass =
    "flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-silver transition-colors hover:text-chalk disabled:opacity-60";

  return (
    <Sheet open={open} onClose={onClose} title="Move to collection">
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-2">
          {collections.map((c) => {
            const current = prompt.collection_id === c.id;
            if (renaming?.id === c.id) {
              return (
                <div key={c.id} className="flex gap-2">
                  <label htmlFor={`rename-collection-${c.id}`} className="sr-only">
                    Collection name
                  </label>
                  <input
                    id={`rename-collection-${c.id}`}
                    value={renameDraft}
                    onChange={(e) => setRenameDraft(e.target.value)}
                    maxLength={60}
                    className="glass font-body min-w-0 flex-1 rounded-xl bg-transparent px-4 py-2.5 text-base text-text focus:outline-none"
                  />
                  <button
                    type="button"
                    disabled={pending || renameDraft.trim() === ""}
                    onClick={() =>
                      run(
                        () => renameCollectionAction(c.id, renameDraft),
                        () => setRenaming(null),
                      )
                    }
                    className="btn-laser min-h-[44px] shrink-0 rounded-xl px-4 text-sm disabled:opacity-50"
                  >
                    Save
                  </button>
                </div>
              );
            }
            return (
              <div key={c.id} className="flex items-center gap-1">
                <button
                  type="button"
                  disabled={pending}
                  aria-pressed={current}
                  onClick={() => (current ? move(null) : move(c.id))}
                  className={rowClass}
                >
                  <span className="min-w-0 truncate">
                    {c.name}
                    <span className="ml-1.5 text-xs text-silver">{c.count}</span>
                  </span>
                  {current && (
                    <span aria-label="Current collection" className="text-accent">
                      ✓
                    </span>
                  )}
                </button>
                <button
                  type="button"
                  disabled={pending}
                  aria-label={`Rename ${c.name}`}
                  onClick={() => {
                    setRenaming(c);
                    setRenameDraft(c.name);
                  }}
                  className={iconClass}
                >
                  <span aria-hidden="true">✎</span>
                </button>
                <button
                  type="button"
                  disabled={pending}
                  aria-label={`Delete ${c.name}`}
                  onClick={() => setConfirmDelete(c)}
                  className={iconClass}
                >
                  <span aria-hidden="true">✕</span>
                </button>
              </div>
            );
          })}
          {prompt.collection_id && (
            <button
              type="button"
              disabled={pending}
              onClick={() => move(null)}
              className={rowClass}
            >
              Remove from its collection
              <span aria-hidden="true">⌫</span>
            </button>
          )}
        </div>

        {/* Inline create — the only way collections come to exist. */}
        <div className="flex gap-2">
          <label htmlFor="new-collection" className="sr-only">
            New collection name
          </label>
          <input
            id="new-collection"
            value={createDraft}
            onChange={(e) => setCreateDraft(e.target.value)}
            placeholder="New collection…"
            maxLength={60}
            className="glass font-body min-w-0 flex-1 rounded-xl bg-transparent px-4 py-2.5 text-base text-text placeholder:text-silver focus:outline-none"
          />
          <button
            type="button"
            disabled={pending || createDraft.trim() === ""}
            onClick={createAndMove}
            className="btn-laser min-h-[44px] shrink-0 rounded-xl px-4 text-sm disabled:opacity-50"
          >
            Create
          </button>
        </div>

        {error && (
          <p className="font-body text-sm text-flare" role="alert">
            {error}
          </p>
        )}
      </div>

      <ConfirmSheet
        open={confirmDelete !== null}
        onClose={() => setConfirmDelete(null)}
        title={`Delete "${confirmDelete?.name ?? ""}"?`}
        body="Prompts inside are kept — they just leave the collection."
        confirmLabel="Delete collection"
        destructive
        onConfirm={() => {
          const target = confirmDelete;
          setConfirmDelete(null);
          if (target) run(() => deleteCollectionAction(target.id));
        }}
      />
    </Sheet>
  );
}
