import { beforeEach, describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { ProfileHydrator } from "@/components/ProfileHydrator";
import { useUIStore } from "@/stores/ui";
import { useEnhanceViewStore, type EnhanceView } from "@/stores/enhance-view";
import { ENHANCE_VIEW_STORE_KEY } from "@/lib/constants";

const VIEW: EnhanceView = {
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

function seedViewStorage(view: EnhanceView, userId?: string) {
  localStorage.setItem(
    ENHANCE_VIEW_STORE_KEY,
    JSON.stringify({ state: { view, userId }, version: 0 }),
  );
}

function hydrateFor(userId: string) {
  return render(<ProfileHydrator theme="system" defaultModel="opus_5" userId={userId} />);
}

beforeEach(() => {
  localStorage.clear();
  useUIStore.setState({ userId: null, editorDraft: "" });
  useEnhanceViewStore.setState({ view: null, userId: null });
});

describe("ProfileHydrator × the persisted enhancement view", () => {
  it("restores the same account's persisted result on load", () => {
    useUIStore.setState({ userId: "account-b" }); // previous load, same account
    seedViewStorage(VIEW, "account-b");
    hydrateFor("account-b");
    expect(useEnhanceViewStore.getState().view).toEqual(VIEW);
  });

  it("adopts a pre-stamp view (null owner), the UI store's own rule", () => {
    useUIStore.setState({ userId: "account-b" });
    seedViewStorage(VIEW); // written by a build before the stamp existed
    hydrateFor("account-b");
    expect(useEnhanceViewStore.getState().view).toEqual(VIEW);
  });

  it("wipes the previous account's result when the account changed", () => {
    useUIStore.setState({ userId: "account-a" }); // previous load: A
    seedViewStorage(VIEW, "account-a");
    hydrateFor("account-b");
    expect(useEnhanceViewStore.getState().view).toBeNull();
    // Unrecoverable, not merely cleared: storage was wiped before rehydrate.
    const raw = localStorage.getItem(ENHANCE_VIEW_STORE_KEY);
    expect(raw === null || JSON.parse(raw).state.view === null).toBe(true);
  });

  it("drops a mismatched-owner view even WITHOUT an account change (cross-tab write)", () => {
    // The Codex catch on PR #85: account A's still-open tab re-writes its
    // view AFTER account B's one-time wipe. The UI store's key then says B
    // (no accountChanged wipe fires) — only the envelope's owner stamp can
    // catch it on B's next load.
    useUIStore.setState({ userId: "account-b" }); // previous load: B
    seedViewStorage(VIEW, "account-a"); // A's tab wrote this afterwards
    hydrateFor("account-b");
    expect(useEnhanceViewStore.getState().view).toBeNull();
    // And the drop is written through, so the stale copy is gone from disk.
    const raw = localStorage.getItem(ENHANCE_VIEW_STORE_KEY);
    expect(raw === null || JSON.parse(raw).state.view === null).toBe(true);
  });
});
