"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

interface Tab {
  href: string;
  label: string;
  icon: ReactNode;
}

/** 1.5px-stroke, rounded-join icons on a 24px grid (style-guide §1.4). */
const TABS: Tab[] = [
  {
    href: "/enhance",
    label: "Enhance",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" className="h-6 w-6">
        <path
          d="M12 3v4M12 17v4M3 12h4M17 12h4M6.3 6.3l2.8 2.8M14.9 14.9l2.8 2.8M17.7 6.3l-2.8 2.8M9.1 14.9l-2.8 2.8"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <circle cx="12" cy="12" r="2.4" stroke="currentColor" strokeWidth="1.5" />
      </svg>
    ),
  },
  {
    href: "/library",
    label: "Library",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" className="h-6 w-6">
        <path
          d="M5 4h11a2 2 0 0 1 2 2v14M7 4v16M5 20h13"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <path d="M10 8h4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      </svg>
    ),
  },
  {
    href: "/profile",
    label: "Profile",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" className="h-6 w-6">
        <circle cx="12" cy="8.5" r="3.5" stroke="currentColor" strokeWidth="1.5" />
        <path
          d="M5 19.5a7 7 0 0 1 14 0"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
        />
      </svg>
    ),
  },
];

export function BottomNav() {
  const pathname = usePathname();

  // The auth gate + onboarding screens show only the brand — no nav.
  // `usePathname` can momentarily be null during transitions; guard it.
  if (
    !pathname ||
    pathname.startsWith("/sign-in") ||
    pathname.startsWith("/set-password")
  ) {
    return null;
  }

  return (
    <nav aria-label="Primary" className="glass-nav fixed inset-x-0 bottom-0 z-50 pb-safe">
      <ul className="mx-auto flex max-w-screen-sm items-stretch justify-around">
        {TABS.map((tab) => {
          const active = pathname === tab.href || pathname.startsWith(`${tab.href}/`);
          return (
            <li key={tab.href} className="flex-1">
              <Link
                href={tab.href}
                aria-current={active ? "page" : undefined}
                className={[
                  "flex min-h-[var(--bottom-nav-h)] flex-col items-center justify-center gap-1 py-2",
                  "text-xs transition-colors",
                  active ? "text-accent" : "text-silver hover:text-chalk",
                ].join(" ")}
              >
                {tab.icon}
                <span className="font-body">{tab.label}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
