import { describe, it, expect, beforeEach } from "vitest";
import { useEnhanceViewStore, type EnhanceView } from "@/stores/enhance-view";
import { ENHANCE_VIEW_STORE_KEY } from "@/lib/constants";

const VALID_VIEW: EnhanceView = {
  submitted: { input: "make this better", mode: "clarify", target: "opus_5" },
  result: {
    output: "a better prompt",
    rationale: "why",
    diff: [],
    tokenIn: 10,
    tokenOut: 20,
    modelUsed: "m",
    costUsd: 0.001,
    usage: { todayCost: 0.01, capUsd: 2 },
  },
};

/** Write a raw persisted envelope the way zustand's persist would. */
function seedStorage(view: unknown) {
  localStorage.setItem(
    ENHANCE_VIEW_STORE_KEY,
    JSON.stringify({ state: { view }, version: 0 }),
  );
}

beforeEach(() => {
  localStorage.clear();
  useEnhanceViewStore.setState({ view: null });
});

describe("useEnhanceViewStore", () => {
  it("defaults to no view and stores one via setView", () => {
    expect(useEnhanceViewStore.getState().view).toBeNull();
    useEnhanceViewStore.getState().setView(VALID_VIEW);
    expect(useEnhanceViewStore.getState().view).toEqual(VALID_VIEW);
    useEnhanceViewStore.getState().setView(null);
    expect(useEnhanceViewStore.getState().view).toBeNull();
  });

  it("persists a set view and restores it on rehydrate (navigation/reload survival)", () => {
    useEnhanceViewStore.getState().setView(VALID_VIEW);
    const raw = localStorage.getItem(ENHANCE_VIEW_STORE_KEY)!;
    expect(JSON.parse(raw).state.view).toEqual(VALID_VIEW);
    // Simulate a fresh app load: in-memory state gone, storage intact. The
    // setState below ALSO writes through persist, so put the "previous
    // load's" copy back before rehydrating.
    useEnhanceViewStore.setState({ view: null });
    localStorage.setItem(ENHANCE_VIEW_STORE_KEY, raw);
    void useEnhanceViewStore.persist.rehydrate();
    expect(useEnhanceViewStore.getState().view).toEqual(VALID_VIEW);
  });

  it("skips hydration at module init — ProfileHydrator owns the rehydrate", () => {
    // The store was imported (module init) with a clean storage; seeding
    // storage NOW must not leak into state until rehydrate is called.
    seedStorage(VALID_VIEW);
    expect(useEnhanceViewStore.getState().view).toBeNull();
    void useEnhanceViewStore.persist.rehydrate();
    expect(useEnhanceViewStore.getState().view).toEqual(VALID_VIEW);
  });

  it("drops a persisted view whose target left the roster (would 400 on refine)", () => {
    seedStorage({
      ...VALID_VIEW,
      submitted: { ...VALID_VIEW.submitted, target: "opus_4_8" },
    });
    void useEnhanceViewStore.persist.rehydrate();
    expect(useEnhanceViewStore.getState().view).toBeNull();
  });

  it("drops a persisted view whose resolvedTarget left the roster", () => {
    seedStorage({
      ...VALID_VIEW,
      result: { ...VALID_VIEW.result, resolvedTarget: "gemini_3_5_thinking" },
    });
    void useEnhanceViewStore.persist.rehydrate();
    expect(useEnhanceViewStore.getState().view).toBeNull();
  });

  it("drops malformed persisted state instead of crashing the composer", () => {
    for (const garbage of [
      "not an object",
      {},
      { submitted: {}, result: {} },
      { ...VALID_VIEW, result: { ...VALID_VIEW.result, output: 42 } },
      { ...VALID_VIEW, submitted: { ...VALID_VIEW.submitted, mode: "bogus" } },
      { ...VALID_VIEW, submitted: { ...VALID_VIEW.submitted, format: "bogus" } },
    ]) {
      // Order matters: setState writes through persist, so seed AFTER it.
      useEnhanceViewStore.setState({ view: VALID_VIEW });
      seedStorage(garbage);
      void useEnhanceViewStore.persist.rehydrate();
      expect(useEnhanceViewStore.getState().view).toBeNull();
    }
  });

  it("keeps optional/additive fields through a round-trip", () => {
    const rich: EnhanceView = {
      submitted: { ...VALID_VIEW.submitted, format: "json", length: "medium" },
      result: {
        ...VALID_VIEW.result,
        resolvedTarget: "fable_5",
        assumptions: ["assumed X"],
        title: "A name",
        salvaged: true,
      },
      refined: true,
    };
    seedStorage(rich);
    void useEnhanceViewStore.persist.rehydrate();
    expect(useEnhanceViewStore.getState().view).toEqual(rich);
  });

  it("clearStorage makes a wiped account's result unrecoverable", () => {
    useEnhanceViewStore.getState().setView(VALID_VIEW);
    useEnhanceViewStore.persist.clearStorage();
    useEnhanceViewStore.setState({ view: null });
    void useEnhanceViewStore.persist.rehydrate();
    expect(useEnhanceViewStore.getState().view).toBeNull();
  });
});
