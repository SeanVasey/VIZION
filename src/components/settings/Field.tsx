import type { SettingStatus } from "@/components/settings/use-setting-write";
import { CheckMark } from "@/components/ui/glyphs";

/** Section-row primitive: label left, control right (lifted out of the old
 *  ProfilePanel so every Settings section shares one shape). */
export function Field({
  label,
  htmlFor,
  children,
}: {
  label: string;
  /** Associates the visible label with its control for AT (WCAG 1.3.1). */
  htmlFor?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-4">
      {htmlFor ? (
        <label htmlFor={htmlFor} className="font-body shrink-0 text-base text-text">
          {label}
        </label>
      ) : (
        <span className="font-body shrink-0 text-base text-text">{label}</span>
      )}
      <div className="min-w-0 flex-1 text-right">{children}</div>
    </div>
  );
}

export function Divider() {
  return <div className="h-px bg-hair" />;
}

/**
 * Per-control save status — rendered NEXT TO the control that changed
 * (2026-07 UX audit), never as one global banner.
 *
 * The region is ALWAYS in the DOM. Returning null when idle meant the whole
 * `role="status"` element was inserted together with its text, and a live
 * region that arrives already populated is not reliably announced — screen
 * readers watch a region they are already observing for changes. "Saved ✓" is
 * the only confirmation a setting persisted, so a silent one is the whole
 * feedback lost.
 *
 * Idle carries `sr-only` rather than an empty static box: every call site sits
 * in a `flex flex-col gap-*`, where a permanently-present static child would
 * add a gap to each row. `sr-only` is absolutely positioned, so it is not a
 * flex item and costs no layout — and the node survives across the swap, which
 * is the only property the announcement depends on.
 */
export function FieldStatus({ status }: { status: SettingStatus | undefined }) {
  const state = status?.state ?? "idle";
  const idle = state === "idle";
  return (
    <p
      role="status"
      className={
        idle
          ? "sr-only"
          : `font-body text-xs ${
              state === "saving"
                ? "text-silver"
                : state === "saved"
                  ? "text-pulse-ink"
                  : "text-flare"
            }`
      }
    >
      {state === "saving" ? (
        "Saving…"
      ) : state === "saved" ? (
        <span className="inline-flex items-center gap-1">
          Saved
          <CheckMark />
        </span>
      ) : state === "error" ? (
        status?.message
      ) : (
        ""
      )}
    </p>
  );
}

/** Section wrapper: uppercase caption + glass card. */
export function SettingsSection({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section aria-label={title} className="flex flex-col gap-2">
      {/* h2, not h3 (A11Y-009): the page h1 is the ScreenHeader title and
          nothing sits between — the visual is entirely class-driven. */}
      <h2 className="font-body px-1 text-xs uppercase tracking-wider text-silver">
        {title}
      </h2>
      <div className="glass flex flex-col gap-4 rounded-2xl p-5">{children}</div>
    </section>
  );
}
