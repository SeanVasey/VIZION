import { describe, it, expect, beforeEach } from "vitest";
import { useUIStore } from "@/stores/ui";

/** Reset to defaults before each test (the store is a module singleton). */
beforeEach(() => {
  useUIStore.setState({
    theme: "system",
    activeMode: "clarify",
    targetModel: "opus_4_8",
    editorDraft: "",
  });
});

describe("useUIStore", () => {
  it("has the locked defaults", () => {
    const s = useUIStore.getState();
    expect(s.theme).toBe("system");
    expect(s.activeMode).toBe("clarify");
    expect(s.targetModel).toBe("opus_4_8");
    expect(s.editorDraft).toBe("");
  });

  it("sets theme, mode, target, and draft", () => {
    const s = useUIStore.getState();
    s.setTheme("light");
    s.setActiveMode("expand");
    s.setTargetModel("gpt_5_5");
    s.setEditorDraft("hello");

    const next = useUIStore.getState();
    expect(next.theme).toBe("light");
    expect(next.activeMode).toBe("expand");
    expect(next.targetModel).toBe("gpt_5_5");
    expect(next.editorDraft).toBe("hello");
  });
});
