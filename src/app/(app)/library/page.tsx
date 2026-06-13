import type { Metadata } from "next";
import { ScreenHeader } from "@/components/ScreenHeader";

export const metadata: Metadata = { title: "Library" };

/** P1 shell of the Library screen.  Saved prompts, versioning, search, and the
 *  activity feed are wired in P4 (server state via TanStack Query). */
export default function LibraryPage() {
  return (
    <>
      <ScreenHeader title="Library" />
      <div className="mx-auto flex max-w-screen-sm flex-col gap-5 px-4 py-5">
        {/* Tag rail (static placeholder). */}
        <div className="flex flex-wrap gap-2">
          {["#marketing", "#code", "+ tag"].map((t) => (
            <span
              key={t}
              className="mono glass rounded-full px-3 py-1.5 text-xs text-silver"
            >
              {t}
            </span>
          ))}
        </div>

        {/* Empty-state card — the server is the source of truth (P4). */}
        <div className="glass rounded-2xl p-6 text-center">
          <p className="font-display text-xl tracking-wide text-text">
            Nothing saved yet
          </p>
          <p className="mt-2 text-sm text-muted">
            Enhanced prompts you save will appear here with full version history and a
            diff between any two versions.
          </p>
          <p className="mono mt-4 text-xs text-silver">Library · arrives in P4</p>
        </div>

        <div>
          <h2 className="mono mb-2 text-xs uppercase tracking-wider text-silver">
            ⟲ Activity
          </h2>
          <div className="glass rounded-2xl p-5 text-center text-sm text-muted">
            Your activity feed will stream created, enhanced, saved, shared, and restored
            events.
          </div>
        </div>
      </div>
    </>
  );
}
