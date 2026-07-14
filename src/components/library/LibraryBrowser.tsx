"use client";

import { memo, useMemo, useState } from "react";
import Link from "next/link";
import { TARGET_MODELS } from "@/lib/constants";
import { filterPrompts, relativeTime } from "@/lib/library/util";
import { DeveloperIcon } from "@/components/models/DeveloperIcon";

export interface PromptCard {
  id: string;
  title: string;
  target_model: string;
  tags: string[];
  updated_at: string;
  versions: number;
}

const MODEL_LABEL = new Map<string, string>(TARGET_MODELS.map((m) => [m.id, m.label]));

/** Saved-prompt browser: search + tag + model filter over the user's library. */
export function LibraryBrowser({ prompts }: { prompts: PromptCard[] }) {
  const [query, setQuery] = useState("");
  const [tag, setTag] = useState<string | null>(null);
  const [model, setModel] = useState<string | null>(null);

  const allTags = useMemo(
    () => Array.from(new Set(prompts.flatMap((p) => p.tags))).sort(),
    [prompts],
  );
  const filtered = useMemo(
    () => filterPrompts(prompts, { query, tag, model }),
    [prompts, query, tag, model],
  );

  if (prompts.length === 0) {
    return (
      <div className="glass rounded-2xl p-6 text-center">
        <p className="font-display text-xl tracking-wide text-text">Nothing saved yet</p>
        <p className="mt-2 text-sm text-muted">
          Enhance a prompt and tap <span className="text-text">Save to library</span> — it
          lands here with full version history.
        </p>
      </div>
    );
  }

  return (
    <section className="flex flex-col gap-4" aria-label="Saved prompts">
      <input
        type="search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search prompts…"
        className="glass font-body w-full rounded-xl bg-transparent px-4 py-3 text-base text-text placeholder:text-muted focus:outline-none"
      />

      {/* Model filter. */}
      <div className="flex flex-wrap gap-2">
        <FilterChip active={model === null} onClick={() => setModel(null)}>
          All models
        </FilterChip>
        {TARGET_MODELS.map((m) => (
          <FilterChip
            key={m.id}
            active={model === m.id}
            onClick={() => setModel(model === m.id ? null : m.id)}
          >
            <DeveloperIcon
              developer={m.developer}
              className={`h-3.5 w-3.5 shrink-0 ${model === m.id ? "" : "text-accent"}`}
            />
            {m.label}
          </FilterChip>
        ))}
      </div>

      {/* Tag filter. */}
      {allTags.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {allTags.map((t) => (
            <FilterChip
              key={t}
              active={tag === t}
              onClick={() => setTag(tag === t ? null : t)}
            >
              #{t}
            </FilterChip>
          ))}
        </div>
      )}

      {/* Cards. */}
      <ul className="flex flex-col gap-3">
        {filtered.map((p) => (
          <PromptRow key={p.id} prompt={p} />
        ))}
        {filtered.length === 0 && (
          <li className="font-body py-6 text-center text-sm text-silver">
            No prompts match your filters.
          </li>
        )}
      </ul>
    </section>
  );
}

/** Memoized card row (R8 perf): re-renders only when its prompt changes. */
const PromptRow = memo(function PromptRow({ prompt: p }: { prompt: PromptCard }) {
  return (
    <li>
      <Link
        href={`/library/${p.id}`}
        className="glass block rounded-2xl p-4 transition-colors hover:border-hair"
      >
        <div className="flex items-start justify-between gap-3">
          <p className="font-body text-base text-text">{p.title}</p>
          <span className="font-body shrink-0 text-xs text-accent">
            {MODEL_LABEL.get(p.target_model) ?? p.target_model}
          </span>
        </div>
        <p className="font-body mt-1 text-xs text-silver">
          edited {relativeTime(p.updated_at)} · {p.versions} version
          {p.versions === 1 ? "" : "s"}
          {p.tags.length > 0 ? ` · ${p.tags.map((t) => `#${t}`).join(" ")}` : ""}
        </p>
      </Link>
    </li>
  );
});

function FilterChip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={[
        "font-body inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs transition-colors",
        active ? "bg-laser text-on-laser" : "glass text-silver hover:text-chalk",
      ].join(" ")}
    >
      {children}
    </button>
  );
}
