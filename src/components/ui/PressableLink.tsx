"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { usePressable } from "@/components/ui/use-pressable";

/**
 * A `<Link>` that carries the app's press affordance.
 *
 * Exists as its own client component because the surfaces that need it —
 * `ScreenHeader` chief among them — are server components, and the press state
 * is necessarily client state. Keeping the split this small means a header
 * stays server-rendered apart from the one control that has to be interactive.
 */
export function PressableLink({
  href,
  className = "",
  children,
  ...rest
}: {
  href: string;
  className?: string;
  children: ReactNode;
} & Omit<React.ComponentProps<typeof Link>, "href" | "className" | "children">) {
  const { pressed, handlers } = usePressable();

  return (
    <Link
      href={href}
      data-pressed={pressed || undefined}
      {...handlers}
      {...rest}
      className={`pressable ${className}`}
    >
      {children}
    </Link>
  );
}
