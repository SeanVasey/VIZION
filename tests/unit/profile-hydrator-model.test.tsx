import { beforeEach, describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { ProfileHydrator } from "@/components/ProfileHydrator";
import { useUIStore } from "@/stores/ui";
import { useEnhanceViewStore } from "@/stores/enhance-view";

beforeEach(() => {
  localStorage.clear();
  useUIStore.setState({
    userId: null,
    targetModel: "grok_4_5", // the device's own last pick
    autoTarget: false,
  });
  useEnhanceViewStore.setState({ view: null, userId: null });
});

/**
 * ProfileHydrator × the default model, since `profiles.default_model` went
 * nullable (owner decisions, 2026-08-15): the Settings choice is
 * AUTHORITATIVE for what a load opens on. A stored default populates with
 * Auto off; a cleared default (null) opens on Auto — and deliberately
 * overrides the device's persisted `autoTarget` in both directions, because
 * that is what makes the setting mean "what the app opens on".
 */
describe("ProfileHydrator × the default model", () => {
  it("populates a stored default with Auto off, even if the device left Auto on", () => {
    useUIStore.setState({ autoTarget: true }); // device toggled Auto last session
    render(<ProfileHydrator theme="system" defaultModel="opus_5" userId="u1" />);
    expect(useUIStore.getState().targetModel).toBe("opus_5");
    expect(useUIStore.getState().autoTarget).toBe(false);
  });

  it("opens on Auto when the default is cleared, keeping the device's pick as the fallback", () => {
    render(<ProfileHydrator theme="system" defaultModel={null} userId="u1" />);
    expect(useUIStore.getState().autoTarget).toBe(true);
    // NOT overwritten: turning Auto off mid-session must return the user to
    // their own last pick (the store's contract), not to anything stored.
    expect(useUIStore.getState().targetModel).toBe("grok_4_5");
  });

  it("forces Auto on under a cleared default, even if the device turned it off", () => {
    useUIStore.setState({ autoTarget: false });
    render(<ProfileHydrator theme="system" defaultModel={null} userId="u1" />);
    expect(useUIStore.getState().autoTarget).toBe(true);
  });
});
