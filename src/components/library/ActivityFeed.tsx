import Link from "next/link";
import { relativeTime } from "@/lib/library/util";
import type { Database } from "@/lib/supabase/database.types";

type ActivityType = Database["public"]["Enums"]["activity_type"];

interface Event {
  id: string;
  type: ActivityType;
  meta: Database["public"]["Tables"]["activity_events"]["Row"]["meta"];
  created_at: string;
  prompt_id: string | null;
}

const VERB: Record<ActivityType, string> = {
  created: "Created",
  enhanced: "Enhanced",
  saved: "Saved",
  shared: "Shared",
  restored: "Restored a version of",
  profile_updated: "Updated profile",
};

/** Activity feed (product-spec §4.4) — created / enhanced / saved / shared /
 *  restored, tied to the profile. Presentational; data fetched by the page. */
export function ActivityFeed({ events }: { events: Event[] }) {
  return (
    <section aria-label="Activity">
      <h2 className="font-body mb-2 text-xs uppercase tracking-wider text-silver">
        <span aria-hidden="true">⟲ </span>Activity
      </h2>
      {events.length === 0 ? (
        <div className="glass rounded-2xl p-5 text-center text-sm text-muted">
          Your activity feed will stream created, enhanced, saved, shared, and restored
          events.
        </div>
      ) : (
        // overflow-hidden clips the row hover fill to the rounded corners.
        <ul className="glass flex flex-col divide-y divide-hair overflow-hidden rounded-2xl">
          {events.map((e) => {
            const title =
              e.meta && typeof e.meta === "object" && "title" in e.meta
                ? String((e.meta as Record<string, unknown>).title)
                : null;
            // Older "restored" rows carry no title — don't dangle "…of".
            const verb =
              e.type === "restored" && !title ? "Restored a version" : VERB[e.type];
            const body = (
              <div className="flex items-center justify-between gap-3 px-4 py-3">
                <span className="font-body text-sm text-text">
                  {verb}
                  {e.type !== "profile_updated" && title ? (
                    <span className="text-silver"> “{title}”</span>
                  ) : null}
                </span>
                <span className="font-body shrink-0 text-xs text-silver">
                  {relativeTime(e.created_at)}
                </span>
              </div>
            );
            return (
              <li key={e.id}>
                {e.prompt_id ? (
                  // Inset focus ring: the list's overflow-hidden would clip
                  // the default outside-the-edge ring on these full-bleed rows.
                  <Link
                    href={`/library/${e.prompt_id}`}
                    className="block transition-colors hover:bg-surface focus-visible:shadow-[inset_0_0_0_1px_var(--accent-ink)]"
                  >
                    {body}
                  </Link>
                ) : (
                  body
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
