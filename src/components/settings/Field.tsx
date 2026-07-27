import type { SettingStatus } from "@/components/settings/use-setting-write";

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

/** Per-control save status — rendered NEXT TO the control that changed
 *  (2026-07 UX audit), never as one global banner. */
export function FieldStatus({ status }: { status: SettingStatus | undefined }) {
  if (!status || status.state === "idle") return null;
  return (
    <p
      role="status"
      className={`font-body text-xs ${
        status.state === "saving"
          ? "text-silver"
          : status.state === "saved"
            ? "text-pulse"
            : "text-flare"
      }`}
    >
      {status.state === "saving"
        ? "Saving…"
        : status.state === "saved"
          ? "Saved ✓"
          : status.message}
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
      <h3 className="font-body px-1 text-xs uppercase tracking-wider text-silver">
        {title}
      </h3>
      <div className="glass flex flex-col gap-4 rounded-2xl p-5">{children}</div>
    </section>
  );
}
