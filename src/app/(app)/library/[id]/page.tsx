import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ScreenHeader } from "@/components/ScreenHeader";
import { createClient } from "@/lib/supabase/server";
import { PromptDetail } from "@/components/library/PromptDetail";

export const metadata: Metadata = { title: "Prompt" };

/** A saved prompt: version history, diff-any-two, restore, revise (product-spec
 *  §4.4). RLS scopes everything to the owner. */
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
    .select(
      "id, input_text, output_text, rationale, mode, model_used, token_in, token_out, created_at, parent_ver",
    )
    .eq("prompt_id", id)
    .order("created_at", { ascending: true });

  return (
    <>
      <ScreenHeader title="Prompt" backHref="/library" />
      <div className="mx-auto max-w-screen-sm px-4 py-5">
        <PromptDetail prompt={prompt} versions={versions ?? []} />
      </div>
    </>
  );
}
