import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ScreenHeader } from "@/components/ScreenHeader";
import { createClient } from "@/lib/supabase/server";
import { PromptDetail } from "@/components/library/PromptDetail";

export const metadata: Metadata = { title: "Prompt" };

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

  const { data: prompt } = await supabase
    .from("prompts")
    .select("id, title, target_model, tags, current_ver, updated_at")
    .eq("id", id)
    .maybeSingle();
  if (!prompt) notFound();

  const { data: versions } = await supabase
    .from("prompt_versions")
    .select("id, mode, model_used, token_in, token_out, created_at, parent_ver")
    .eq("prompt_id", id)
    .order("created_at", { ascending: true });

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
