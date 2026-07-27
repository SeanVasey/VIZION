"use client";

import { useEffect } from "react";
import { useUIStore } from "@/stores/ui";

/** Stamps the root `data-reduced-effects` attribute from the persisted
 *  preference so the CSS ambient-layer suppression applies app-wide. */
export function ReducedEffectsManager() {
  const reducedEffects = useUIStore((s) => s.reducedEffects);
  useEffect(() => {
    document.documentElement.toggleAttribute("data-reduced-effects", reducedEffects);
  }, [reducedEffects]);
  return null;
}
