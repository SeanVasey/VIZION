import type { Metadata } from "next";
import { cache } from "react";
import { notFound } from "next/navigation";
import { ScreenHeader } from "@/components/ScreenHeader";
import { createClient } from "@/lib/supabase/server";
import { PromptDetail } from "@/components/library/PromptDetail";

/** One head query shared by generateMetadata and the page (React cache():
 *  both callers run in the same request render, so the second call is free).
 *  The error is returned, not swallowed — a transient query failure used to
 *  destructure to `data: null` and 404 an existing prompt (audit VAR-04). */
const getPromptHead = cache(async (id: string) => {
  const supabase = await createClient();
  // Soft-deleted prompts 404 here (LIB-006): they are excluded from every
  // list yet stayed fully readable AND writable via a remembered URL.
  return supabase
    .from("prompts")
    .select("id, title, target_model, tags, current_ver, updated_at")
    .eq("id", id)
    .is("deleted_at", null)
    .maybeSingle();
});

/** The prompt's own title in the tab (audit VAR-16) — every saved prompt used
 *  to share one static "Prompt · VIZION" identity. A missing id 404s from
 *  HERE so the not-found surface carries its own "Not found" title instead of
 *  a contradictory "Prompt". A query ERROR deliberately does not 404: the
 *  page renders its can't-load state under the generic title. */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const { data, error } = await getPromptHead(id);
  if (!data && !error) notFound();
  return { title: data?.title ?? "Prompt" };
}

/** A saved prompt: version history, diff-any-two, restore, revise (product-spec
 *  §4.4). RLS scopes everything to the owner.
 *
 *  Scale (2026-07 UX audit): the page ships version METADATA only, plus the
 *  bodies of the default compare pair (current + its parent) — a prompt with
 *  fifty versions no longer downloads fifty full input/output/rationale
 *  bodies. Other bodies load on demand via getVersionBodyAction. */
export default async function PromptPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();

  const { data: prompt, error: promptError } = await getPromptHead(id);

  // A failed query must not masquerade as "not found" (audit VAR-04): the
  // prompt still exists on the server. Same treatment as the library list's
  // can't-load state.
  if (promptError) return <DetailLoadError />;
  if (!prompt) notFound();

  const { data: versions, error: versionsError } = await supabase
    .from("prompt_versions")
    .select("id, mode, model_used, token_in, token_out, created_at, parent_ver")
    .eq("prompt_id", id)
    .order("created_at", { ascending: true });

  // Same rule for the history: collapsing a query error into `?? []` rendered
  // a false "0 versions" shell with a copy button that silently no-ops.
  if (versionsError) return <DetailLoadError />;

  const meta = versions ?? [];
  const currentId = prompt.current_ver ?? meta[meta.length - 1]?.id ?? null;
  const current = meta.find((v) => v.id === currentId);
  const seedIds = [
    ...new Set([currentId, current?.parent_ver].filter((x): x is string => !!x)),
  ];
  const { data: bodies } = seedIds.length
    ? await supabase
        .from("prompt_versions")
        .select("id, input_text, output_text, rationale")
        .in("id", seedIds)
    : { data: [] };

  return (
    <>
      <ScreenHeader title="Prompt" backHref="/library" />
      <div className="mx-auto max-w-screen-sm px-4 py-5">
        <PromptDetail prompt={prompt} versions={meta} initialBodies={bodies ?? []} />
      </div>
    </>
  );
}

/** The library list's established can't-load treatment, on the detail route. */
function DetailLoadError() {
  return (
    <>
      <ScreenHeader title="Prompt" backHref="/library" />
      <div className="mx-auto flex max-w-screen-sm flex-col px-4 py-5">
        <div className="glass rounded-2xl p-6 text-center" role="alert">
          <p className="font-display text-balance text-xl tracking-wide text-text">
            Couldn&apos;t load this prompt
          </p>
          <p className="font-body mt-2 text-sm text-muted">
            It&apos;s safe on the server — check your connection and reload.
          </p>
        </div>
      </div>
    </>
  );
}
