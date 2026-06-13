import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Type-role contract (remediation R2): JetBrains Mono is scoped to the
 * enhanced-prompt OUTPUT region only.  These UI surfaces must never carry the
 * `mono` utility class — they are Reddit Sans (body/UI) by contract.
 */
const ROOT = join(__dirname, "..", "..");

const UI_ONLY_FILES = [
  "src/components/editor/EnhanceComposer.tsx",
  "src/components/editor/ModeRig.tsx",
  "src/components/auth/SignInForm.tsx",
  "src/components/nav/BottomNav.tsx",
  "src/components/profile/ProfilePanel.tsx",
  "src/components/library/LibraryBrowser.tsx",
  "src/components/library/ActivityFeed.tsx",
  "src/components/Wordmark.tsx",
];

// Matches the `mono` Tailwind utility as a standalone class token.
const MONO_CLASS = /(["'`\s])mono(["'`\s])/;

describe("type-role scoping (mono = output only)", () => {
  for (const rel of UI_ONLY_FILES) {
    it(`${rel} uses no mono class (Reddit Sans only)`, () => {
      const src = readFileSync(join(ROOT, rel), "utf8");
      expect(MONO_CLASS.test(src)).toBe(false);
    });
  }

  it("the prompt input editor is Reddit Sans (font-body)", () => {
    const src = readFileSync(
      join(ROOT, "src/components/editor/EnhanceComposer.tsx"),
      "utf8",
    );
    // The textarea line must declare font-body and must not be mono.
    expect(src).toMatch(/id="prompt-input"[\s\S]*?font-body/);
  });
});
