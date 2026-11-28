import { describe, it, expect, beforeEach } from "vitest";
import { useUIStore } from "@/stores/ui";
import { LEGACY_TARGET_IDS } from "@/lib/constants";

/** Reset to defaults before each test (the store is a module singleton). */
beforeEach(() => {
  useUIStore.setState({
    theme: "system",
    activeMode: "clarify",
    targetModel: "opus_5_5",
    thinkingLevel: null,
    editorDraft: "",
  });
});

describe("useUIStore", () => {
  it("has the locked defaults", () => {
    const s = useUIStore.getState();
    expect(s.theme).toBe("system");
    expect(s.activeMode).toBe("clarify");
    expect(s.targetModel).toBe("opus_5_5");
    expect(s.editorDraft).toBe("");
  });

  it("sets theme, mode, target, and draft", () => {
    const s = useUIStore.getState();
    s.setTheme("light");
    s.setActiveMode("expand");
    s.setTargetModel("gpt_6_2_sol");
    s.setEditorDraft("hello");

    const next = useUIStore.getState();
    expect(next.theme).toBe("light");
    expect(next.activeMode).toBe("expand");
    expect(next.targetModel).toBe("gpt_6_2_sol");
    expect(next.editorDraft).toBe("hello");
  });

  it("migrates legacy persisted target-model IDs (v0-v4 → v5)", () => {
    const migrate = useUIStore.persist.getOptions().migrate!;
    // Renamed IDs map to their successors.
    expect(migrate({ targetModel: "gpt_5_5" }, 0)).toMatchObject({
      targetModel: "gpt_6_2_sol",
    });
    // Renamed twice — a v0 store must land on the CURRENT id, not the next hop.
    expect(migrate({ targetModel: "gemini_pro_3_1" }, 0)).toMatchObject({
      targetModel: "gemini_4_hydrogen",
    });
    expect(migrate({ targetModel: "gemini_3_5_thinking" }, 4)).toMatchObject({
      targetModel: "gemini_4_hydrogen",
    });
    expect(migrate({ targetModel: "opus_4_8" }, 1)).toMatchObject({
      targetModel: "opus_5_5",
    });
    expect(migrate({ targetModel: "llama_4_maverick" }, 2)).toMatchObject({
      targetModel: "muse_spark_1_3",
    });
    expect(migrate({ targetModel: "kimi_k2_6" }, 3)).toMatchObject({
      targetModel: "kimi_k3_1_pro",
    });
    expect(migrate({ targetModel: "minimax_m2_7" }, 3)).toMatchObject({
      targetModel: "minimax_m3_1_flash",
    });
    // Current IDs pass through; unknown IDs fall back to the default.
    expect(migrate({ targetModel: "fable_5_2" }, 0)).toMatchObject({
      targetModel: "fable_5_2",
    });
    expect(migrate({ targetModel: "bogus" }, 0)).toMatchObject({
      targetModel: "opus_5_5",
    });
  });

  it("stores ONE thinking level for every model and clears back to Auto with null", () => {
    // ADR-0018: the dial is the same four stops whatever the target, so the
    // value is a single field — switching models no longer changes it.
    useUIStore.getState().setThinkingLevel("max");
    expect(useUIStore.getState().thinkingLevel).toBe("max");
    useUIStore.getState().setTargetModel("gemini_4_hydrogen");
    expect(useUIStore.getState().thinkingLevel).toBe("max");
    useUIStore.getState().setThinkingLevel(null);
    expect(useUIStore.getState().thinkingLevel).toBeNull();
  });

  it("v6 defaults the media privacy prefs for pre-v6 persisted state", () => {
    const migrate = useUIStore.persist.getOptions().migrate!;
    const next = migrate({ targetModel: "opus_5_5" }, 5) as {
      mediaNoticeAcknowledged: boolean;
      mediaStoreByDefault: boolean;
    };
    expect(next.mediaNoticeAcknowledged).toBe(false);
    expect(next.mediaStoreByDefault).toBe(true);
    // Already-set values pass through untouched.
    const kept = migrate(
      {
        targetModel: "opus_5_5",
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
          targetModel: "opus_5_5",
          thinkingLevels: { opus_5_5: "xhigh", gpt_6_2_sol: "low", bogus: "max" },
        },
        6,
      ),
    ).toMatchObject({ targetModel: "opus_5_5", thinkingLevel: "high" });
    expect(
      migrate({ targetModel: "opus_5_5", thinkingLevels: {} }, 6),
    ).not.toHaveProperty("thinkingLevels");
    // A renamed target still finds its entry under either id.
    expect(
      migrate(
        {
          targetModel: "gemini_3_6_flash",
          thinkingLevels: { gemini_3_6_flash: "minimal" },
        },
        6,
      ),
    ).toMatchObject({ targetModel: "gemini_4_hydrogen", thinkingLevel: "low" });
    expect(
      migrate({ targetModel: "fable_5", thinkingLevels: { fable_5_2: "max" } }, 6),
    ).toMatchObject({
      targetModel: "fable_5_2",
      thinkingLevel: "max",
    });
    // Nothing stored, or garbage → Auto.
    expect(migrate({ targetModel: "opus_5_5" }, 6)).toMatchObject({
      thinkingLevel: null,
    });
    expect(migrate({ targetModel: "opus_5_5", thinkingLevel: "deep" }, 7)).toMatchObject({
      thinkingLevel: null,
    });
    // A v7 value passes through.
    expect(
      migrate({ targetModel: "opus_5_5", thinkingLevel: "medium" }, 7),
    ).toMatchObject({
      thinkingLevel: "medium",
    });
  });

  it("migrates the 2026-09 frontier renames (v6 → v7)", () => {
    const migrate = useUIStore.persist.getOptions().migrate!;
    for (const [legacy, current] of [
      ["fable_5", "fable_5_2"],
      ["gemini_3_6_flash", "gemini_4_hydrogen"],
      ["grok_4_5", "grok_4_7"],
      ["glm_5_2", "glm_5_3"],
    ] as const) {
      expect(migrate({ targetModel: legacy }, 6)).toMatchObject({ targetModel: current });
    }
  });

  it("migrates the 2026-11 frontier renames (v7 → v8)", () => {
    const migrate = useUIStore.persist.getOptions().migrate!;
    for (const [legacy, current] of [
      ["fable_5_1", "fable_5_2"],
      ["opus_5", "opus_5_5"],
      ["sonnet_5", "sonnet_5_5"],
      ["gpt_6_astra", "gpt_6_2_astra"],
      ["gpt_5_6_sol", "gpt_6_2_sol"],
      ["gpt_5_6_terra", "gpt_6_1_terra"],
      ["gpt_5_6_luna", "gpt_6_luna"],
      ["gemini_3_8_flash", "gemini_4_hydrogen"],
      ["muse_spark_1_1", "muse_spark_1_3"],
      ["minimax_m3", "minimax_m3_1_flash"],
      ["mistral_large_3", "mistral_large_4"],
      ["kimi_k3", "kimi_k3_1_pro"],
      ["qwen3_8_max", "qwen4_max"],
      ["grok_4_6", "grok_4_7"],
    ] as const) {
      // A v7 store keeps its chosen thinking level across the rename.
      expect(migrate({ targetModel: legacy, thinkingLevel: "high" }, 7)).toMatchObject({
        targetModel: current,
        thinkingLevel: "high",
      });
    }
  });

  it("bumps the persist version with every roster rename", () => {
    // zustand runs `migrate` ONLY when the stored version differs from this
    // one. The migrate function above can be perfectly correct and still
    // never execute: ship a rename under an unchanged version and every
    // device that had picked a renamed model keeps an id /api/enhance 400s
    // on. Nothing else pins this — the migrate tests call the function
    // directly — so the version is tied to the size of the legacy map: add
    // a rename to LEGACY_TARGET_IDS and this fails until the version moves.
    expect({
      version: useUIStore.persist.getOptions().version,
      legacyIds: Object.keys(LEGACY_TARGET_IDS).length,
    }).toEqual({ version: 8, legacyIds: 26 });
  });
});
