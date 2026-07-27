import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useSettingWrite } from "@/components/settings/use-setting-write";

describe("useSettingWrite (the one persistence path)", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("runs saving → saved → idle on success", async () => {
    const { result } = renderHook(() => useSettingWrite());
    await act(async () => {
      result.current.write("theme", async () => ({ ok: true }));
    });
    expect(result.current.status.theme?.state).toBe("saved");
    act(() => {
      vi.advanceTimersByTime(2100);
    });
    expect(result.current.status.theme?.state).toBe("idle");
  });

  it("rolls back and reports the error on failure", async () => {
    const rollback = vi.fn();
    const { result } = renderHook(() => useSettingWrite());
    await act(async () => {
      result.current.write(
        "default_model",
        async () => ({ ok: false, error: "That model is unavailable." }),
        rollback,
      );
    });
    expect(rollback).toHaveBeenCalledTimes(1);
    expect(result.current.status.default_model).toEqual({
      state: "error",
      message: "That model is unavailable.",
    });
  });

  it("rolls back on a thrown (network) failure too", async () => {
    const rollback = vi.fn();
    const { result } = renderHook(() => useSettingWrite());
    await act(async () => {
      result.current.write(
        "x",
        async () => {
          throw new Error("offline");
        },
        rollback,
      );
    });
    expect(rollback).toHaveBeenCalled();
    expect(result.current.status.x?.state).toBe("error");
  });

  it("tracks keys independently", async () => {
    const { result } = renderHook(() => useSettingWrite());
    await act(async () => {
      result.current.write("a", async () => ({ ok: true }));
      result.current.write("b", async () => ({ ok: false, error: "no" }));
    });
    expect(result.current.status.a?.state).toBe("saved");
    expect(result.current.status.b?.state).toBe("error");
  });
});
