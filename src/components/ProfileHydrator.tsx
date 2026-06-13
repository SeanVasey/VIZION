"use client";

import { useEffect, useRef } from "react";
import { useUIStore } from "@/stores/ui";
import type { Theme, TargetModelId } from "@/lib/constants";

/**
 * Applies the user's saved preferences (theme + default model) to the local UI
 * store once per app load, so a fresh device reflects their account. Rendered by
 * the authenticated layout, which mounts once — subsequent in-app navigations
 * don't re-run it, so live local toggles aren't clobbered.
 */
export function ProfileHydrator({
  theme,
  defaultModel,
}: {
  theme: Theme;
  defaultModel: TargetModelId;
}) {
  const hydrated = useRef(false);

  useEffect(() => {
    if (hydrated.current) return;
    hydrated.current = true;
    useUIStore.setState({ theme, targetModel: defaultModel });
  }, [theme, defaultModel]);

  return null;
}
