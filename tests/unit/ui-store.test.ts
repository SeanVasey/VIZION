import { describe, it, expect, beforeEach } from "vitest";
import { useUIStore } from "@/stores/ui";

/** Reset to defaults before each test (the store is a module singleton). */
beforeEach(() => {
  useUIStore.setState({
    theme: "system",
    activeMode: "clarify",
    targetModel: "opus_5",
    thinkingLevels: {},
    editorDraft: "",
  });
});

describe("useUIStore", () => {
  it("has the locked defaults", () => {
    const s = useUIStore.getState();
    expect(s.theme).toBe("system");
    expect(s.activeMode).toBe("clarify");
    expect(s.targetModel).toBe("opus_5");
    expect(s.editorDraft).toBe("");
  });

  it("sets theme, mode, target, and draft", () => {
    const s = useUIStore.getState();
    s.setTheme("light");
    s.setActiveMode("expand");
    s.setTargetModel("gpt_5_6_sol");
    s.setEditorDraft("hello");

    const next = useUIStore.getState();
    expect(next.theme).toBe("light");
    expect(next.activeMode).toBe("expand");
    expect(next.targetModel).toBe("gpt_5_6_sol");
    expect(next.editorDraft).toBe("hello");
  });

  it("migrates legacy persisted target-model IDs (v0-v4 → v5)", () => {
    const migrate = useUIStore.persist.getOptions().migrate!;
    // Renamed IDs map to their successors.
    expect(migrate({ targetModel: "gpt_5_5" }, 0)).toMatchObject({
      targetModel: "gpt_5_6_sol",
    });
    // Renamed twice — a v0 store must land on the CURRENT id, not the next hop.
    expect(migrate({ targetModel: "gemini_pro_3_1" }, 0)).toMatchObject({
      targetModel: "gemini_3_6_flash",
    });
    expect(migrate({ targetModel: "gemini_3_5_thinking" }, 4)).toMatchObject({
      targetModel: "gemini_3_6_flash",
    });
    expect(migrate({ targetModel: "opus_4_8" }, 1)).toMatchObject({
      targetModel: "opus_5",
    });
    expect(migrate({ targetModel: "llama_4_maverick" }, 2)).toMatchObject({
      targetModel: "muse_spark_1_1",
    });
    expect(migrate({ targetModel: "kimi_k2_6" }, 3)).toMatchObject({
      targetModel: "kimi_k3",
    });
    expect(migrate({ targetModel: "minimax_m2_7" }, 3)).toMatchObject({
      targetModel: "minimax_m3",
    });
    // Current IDs pass through; unknown IDs fall back to the default.
    expect(migrate({ targetModel: "fable_5" }, 0)).toMatchObject({
      targetModel: "fable_5",
    });
    expect(migrate({ targetModel: "bogus" }, 0)).toMatchObject({
      targetModel: "opus_5",
    });
  });

  it("stores a thinking level per target and clears back to Auto with null", () => {
    useUIStore.getState().setThinkingLevel("opus_5", "xhigh");
    useUIStore.getState().setThinkingLevel("gemini_3_6_flash", "minimal");
    expect(useUIStore.getState().thinkingLevels).toEqual({
      opus_5: "xhigh",
      gemini_3_6_flash: "minimal",
    });

    // Each target keeps its own dial; clearing one leaves the other alone.
    useUIStore.getState().setThinkingLevel("opus_5", null);
    expect(useUIStore.getState().thinkingLevels).toEqual({
      gemini_3_6_flash: "minimal",
    });
  });

  it("v6 defaults the media privacy prefs for pre-v6 persisted state", () => {
    const migrate = useUIStore.persist.getOptions().migrate!;
    const next = migrate({ targetModel: "opus_5" }, 5) as {
      mediaNoticeAcknowledged: boolean;
      mediaStoreByDefault: boolean;
    };
    expect(next.mediaNoticeAcknowledged).toBe(false);
    expect(next.mediaStoreByDefault).toBe(true);
    // Already-set values pass through untouched.
    const kept = migrate(
      { targetModel: "opus_5", mediaNoticeAcknowledged: true, mediaStoreByDefault: false },
      5,
    ) as { mediaNoticeAcknowledged: boolean; mediaStoreByDefault: boolean };
    expect(kept.mediaNoticeAcknowledged).toBe(true);
    expect(kept.mediaStoreByDefault).toBe(false);
  });

  it("migrates persisted thinking levels: re-keys renames, drops stale entries", () => {
    const migrate = useUIStore.persist.getOptions().migrate!;
    const next = migrate(
      {
        targetModel: "opus_5",
        thinkingLevels: {
          gemini_3_5_thinking: "high", // renamed target — carries to the new id
          opus_5: "xhigh", // valid — passes through
          gpt_5_6_sol: "max", // level the OpenAI trio doesn't offer — dropped
          deepseek_v4: "high", // target with no knob — dropped
          bogus: "low", // unknown target — dropped
        },
      },
      4,
    ) as { thinkingLevels: Record<string, string> };
    expect(next.thinkingLevels).toEqual({
      gemini_3_6_flash: "high",
      opus_5: "xhigh",
    });
  });
});
