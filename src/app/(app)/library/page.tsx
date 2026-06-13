import type { Metadata } from "next";
import { ScreenHeader } from "@/components/ScreenHeader";
import { createClient } from "@/lib/supabase/server";
import { LibraryBrowser, type PromptCard } from "@/components/library/LibraryBrowser";
import { ActivityFeed } from "@/components/library/ActivityFeed";
import { Footer } from "@/components/Footer";

export const metadata: Metadata = { title: "Library" };

/** Library — saved prompts with tags/search/model filter + the activity feed
 *  (product-spec §4.4). Server state via Supabase, scoped by RLS. */
export default async function LibraryPage() {
  const supabase = await createClient();

  const { data: prompts } = await supabase
    .from("prompts")
    .select("id, title, target_model, tags, updated_at")
    .order("updated_at", { ascending: false });

  const ids = (prompts ?? []).map((p) => p.id);

  // Version counts (light: ids only) keyed by prompt.
  const counts = new Map<string, number>();
  if (ids.length) {
    const { data: vers } = await supabase
      .from("prompt_versions")
      .select("prompt_id")
      .in("prompt_id", ids);
    for (const v of vers ?? []) {
      counts.set(v.prompt_id, (counts.get(v.prompt_id) ?? 0) + 1);
    }
  }

  const cards: PromptCard[] = (prompts ?? []).map((p) => ({
    id: p.id,
    title: p.title,
    target_model: p.target_model,
    tags: p.tags,
    updated_at: p.updated_at,
    versions: counts.get(p.id) ?? 1,
  }));

  const { data: activity } = await supabase
    .from("activity_events")
    .select("id, type, meta, created_at, prompt_id")
    .order("created_at", { ascending: false })
    .limit(20);

  return (
    <>
      <ScreenHeader title="Library" />
      <div className="mx-auto flex max-w-screen-sm flex-col gap-6 px-4 py-5">
        <LibraryBrowser prompts={cards} />
        <ActivityFeed events={activity ?? []} />
        <Footer inset />
      </div>
    </>
  );
}
