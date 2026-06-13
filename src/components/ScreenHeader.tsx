import type { ReactNode } from "react";
import Image from "next/image";
import { Wordmark } from "@/components/Wordmark";
import { ThemeToggle } from "@/components/ThemeToggle";

/**
 * Full-bleed glass header with the safe-area top inset baked in.  Shows the
 * wordmark on the primary screen and a plain title elsewhere.
 */
export function ScreenHeader({
  title,
  brand = false,
  action,
}: {
  title?: string;
  brand?: boolean;
  action?: ReactNode;
}) {
  return (
    <header className="glass sticky top-0 z-40 pt-safe">
      <div className="mx-auto flex max-w-screen-sm items-center justify-between gap-3 px-4 py-3">
        {brand ? (
          <div className="flex items-center gap-2">
            {/* App icon (squircle) to the LEFT of the wordmark — R1.1. */}
            <Image
              src="/brand/vizion-icon-token.svg"
              alt=""
              width={36}
              height={36}
              priority
              className="h-9 w-9 rounded-[10px]"
            />
            <Wordmark className="text-2xl" />
          </div>
        ) : (
          <h1 className="font-display text-xl tracking-wide text-text">{title}</h1>
        )}
        <div className="flex items-center gap-2">
          {action}
          <ThemeToggle />
        </div>
      </div>
    </header>
  );
}
