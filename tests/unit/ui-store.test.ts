import { describe, it, expect, beforeEach } from "vitest";
import { useUIStore } from "@/stores/ui";

/** Reset to defaults before each test (the store is a module singleton). */
beforeEach(() => {
  useUIStore.setState({
    theme: "system",
    activeMode: "clarify",
    targetModel: "opus_5",
    thinkingLevel: null,
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
      targetModel: "gemini_3_8_flash",
    });
    expect(migrate({ targetModel: "gemini_3_5_thinking" }, 4)).toMatchObject({
      targetModel: "gemini_3_8_flash",
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
    expect(migrate({ targetModel: "fable_5_1" }, 0)).toMatchObject({
      targetModel: "fable_5_1",
    });
    expect(migrate({ targetModel: "bogus" }, 0)).toMatchObject({
      targetModel: "opus_5",
    });
  });

  it("stores ONE thinking level for every model and clears back to Auto with null", () => {
    // ADR-0018: the dial is the same four stops whatever the target, so the
    // value is a single field — switching models no longer changes it.
    useUIStore.getState().setThinkingLevel("max");
    expect(useUIStore.getState().thinkingLevel).toBe("max");
    useUIStore.getState().setTargetModel("gemini_3_8_flash");
    expect(useUIStore.getState().thinkingLevel).toBe("max");
    useUIStore.getState().setThinkingLevel(null);
    expect(useUIStore.getState().thinkingLevel).toBeNull();
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
      {
        targetModel: "opus_5",
        mediaNoticeAcknowledged: true,
        mediaStoreByDefault: false,
      },
      5,
    ) as { mediaNoticeAcknowledged: boolean; mediaStoreByDefault: boolean };
    expect(kept.mediaNoticeAcknowledged).toBe(true);
    expect(kept.mediaStoreByDefault).toBe(false);
  });

  it("v7 collapses the per-target record onto the pinned target's level, folded onto the ladder", () => {
    const migrate = useUIStore.persist.getOptions().migrate!;
    // The stored target's own entry carries over; every other target's is
    // dropped (null is Auto, the safe default); `xhigh` folds onto high.
    expect(
      migrate(
        {
          targetModel: "opus_5",
          thinkingLevels: { opus_5: "xhigh", gpt_5_6_sol: "low", bogus: "max" },
        },
        6,
      ),
    ).toMatchObject({ targetModel: "opus_5", thinkingLevel: "high" });
    expect(migrate({ targetModel: "opus_5", thinkingLevels: {} }, 6)).not.toHaveProperty(
      "thinkingLevels",
    );
    // A renamed target still finds its entry under either id.
    expect(
      migrate(
        {
          targetModel: "gemini_3_6_flash",
          thinkingLevels: { gemini_3_6_flash: "minimal" },
        },
        6,
      ),
    ).toMatchObject({ targetModel: "gemini_3_8_flash", thinkingLevel: "low" });
    expect(
      migrate({ targetModel: "fable_5", thinkingLevels: { fable_5_1: "max" } }, 6),
    ).toMatchObject({
      targetModel: "fable_5_1",
      thinkingLevel: "max",
    });
    // Nothing stored, or garbage → Auto.
    expect(migrate({ targetModel: "opus_5" }, 6)).toMatchObject({ thinkingLevel: null });
    expect(migrate({ targetModel: "opus_5", thinkingLevel: "deep" }, 7)).toMatchObject({
      thinkingLevel: null,
    });
    // A v7 value passes through.
    expect(migrate({ targetModel: "opus_5", thinkingLevel: "medium" }, 7)).toMatchObject({
      thinkingLevel: "medium",
    });
  });

  it("migrates the 2026-09 frontier renames (v6 → v7)", () => {
    const migrate = useUIStore.persist.getOptions().migrate!;
    for (const [legacy, current] of [
      ["fable_5", "fable_5_1"],
      ["gemini_3_6_flash", "gemini_3_8_flash"],
      ["grok_4_5", "grok_4_6"],
      ["glm_5_2", "glm_5_3"],
    ] as const) {
      expect(migrate({ targetModel: legacy }, 6)).toMatchObject({ targetModel: current });
    }
  });
});
