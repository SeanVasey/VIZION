"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export type SettingState = "idle" | "saving" | "saved" | "error";

export interface SettingStatus {
  state: SettingState;
  message?: string;
}

export interface ActionLikeResult {
  ok: boolean;
  error?: string;
}

/**
 * THE one persistence path for settings (2026-07 UX audit): every durable
 * write goes through `write(key, run, rollback)` — optimistic local apply is
 * the caller's job, this hook owns the server round trip, per-control status
 * ("Saving… / Saved ✓ / error"), auto-clearing success, and rollback on
 * failure. Replaces the old three-idiom split (batched save / immediate
 * action / raw fire-and-forget client write).
 */
export function useSettingWrite(): {
  status: Record<string, SettingStatus>;
  write: (
    key: string,
    run: () => Promise<ActionLikeResult>,
    rollback?: () => void,
  ) => void;
} {
  const [status, setStatus] = useState<Record<string, SettingStatus>>({});
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());

  useEffect(
    () => () => {
      for (const t of timers.current.values()) clearTimeout(t);
    },
    [],
  );

  const write = useCallback(
    (key: string, run: () => Promise<ActionLikeResult>, rollback?: () => void) => {
      const existing = timers.current.get(key);
      if (existing) clearTimeout(existing);
      setStatus((s) => ({ ...s, [key]: { state: "saving" } }));
      run()
        .then((res) => {
          if (res.ok) {
            setStatus((s) => ({ ...s, [key]: { state: "saved" } }));
            timers.current.set(
              key,
              setTimeout(
                () => setStatus((s) => ({ ...s, [key]: { state: "idle" } })),
                2000,
              ),
            );
          } else {
            rollback?.();
            setStatus((s) => ({
              ...s,
              [key]: { state: "error", message: res.error ?? "Couldn't save." },
            }));
          }
        })
        .catch(() => {
          rollback?.();
          setStatus((s) => ({
            ...s,
            [key]: {
              state: "error",
              message: "Couldn't save — check your connection.",
            },
          }));
        });
    },
    [],
  );

  return { status, write };
}
