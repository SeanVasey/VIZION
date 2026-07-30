import { TARGET_MODELS } from "@/lib/constants";

/**
 * Model id → display label.
 *
 * Its own module so client components can read labels without pulling in a
 * component that happens to have built the same map privately — three surfaces
 * had already declared `new Map(TARGET_MODELS.map(...))` locally.
 */
export const MODEL_LABELS = new Map<string, string>(
  TARGET_MODELS.map((m) => [m.id as string, m.label]),
);
