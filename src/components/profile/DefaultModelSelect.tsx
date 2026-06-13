"use client";

import { useUIStore } from "@/stores/ui";
import { TARGET_MODELS } from "@/lib/constants";

/**
 * Default-model preference.  In P1 this is backed by the local UI store; in P2
 * it syncs to `Profile.default_model` in Supabase (server as source of truth).
 */
export function DefaultModelSelect() {
  const targetModel = useUIStore((s) => s.targetModel);
  const setTargetModel = useUIStore((s) => s.setTargetModel);

  return (
    <div className="glass rounded-xl">
      <label htmlFor="default-model" className="sr-only">
        Default model
      </label>
      <select
        id="default-model"
        value={targetModel}
        onChange={(e) => setTargetModel(e.target.value as typeof targetModel)}
        className="font-body rounded-xl bg-transparent px-3 py-2 text-sm text-text focus:outline-none"
      >
        {TARGET_MODELS.map((m) => (
          <option key={m.id} value={m.id} className="bg-onyx text-chalk">
            {m.label}
          </option>
        ))}
      </select>
    </div>
  );
}
