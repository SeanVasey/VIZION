import { APP_VERSION } from "@/lib/version";
import { SettingsSection, Field, Divider } from "@/components/settings/Field";

/** About: version (single-sourced from package.json via lib/version — never
 *  hardcoded), acknowledgements, and where the legal texts live. */
export function AboutSection() {
  return (
    <SettingsSection title="About">
      <Field label="Version">
        <span className="font-body text-sm tabular-nums text-silver">
          v{APP_VERSION}
        </span>
      </Field>
      <Divider />
      <div className="flex flex-col gap-1">
        <p className="font-body text-base text-text">Acknowledgements</p>
        <p className="font-body text-xs leading-relaxed text-silver">
          Type: Bebas Neue, Reddit Sans, and JetBrains Mono (SIL Open Font
          License). Developer marks via thesvg.org and Simple Icons. Built on
          Next.js and Supabase.
        </p>
      </div>
      <Divider />
      <p className="font-body text-xs leading-relaxed text-silver">
        VIZ(IO)N is a VASEY/AI product. License and security policy live in the
        repository (LICENSE · SECURITY.md).
      </p>
    </SettingsSection>
  );
}
