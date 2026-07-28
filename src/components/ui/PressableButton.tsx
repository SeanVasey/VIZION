"use client";

import type { ReactNode } from "react";
import { usePressable } from "@/components/ui/use-pressable";

/**
 * A `<button>` that carries the app's press affordance — the icon-button
 * counterpart to `PressableLink`. Callers keep full control of the visual
 * classes; this only adds `.pressable` and the state that drives it.
 */
export function PressableButton({
  className = "",
  children,
  ...rest
}: {
  className?: string;
  children: ReactNode;
} & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  const { pressed, handlers } = usePressable();

  return (
    <button
      // Defaulted, not assumed. A bare <button> is `type="submit"`, so an icon
      // button that later lands inside a <form> would silently submit it. It
      // sits BEFORE the spread so a caller that genuinely wants submit/reset
      // can still say so.
      type="button"
      data-pressed={pressed || undefined}
      {...handlers}
      {...rest}
      className={`pressable ${className}`}
    >
      {children}
    </button>
  );
}
