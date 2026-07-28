"use client";

import Link, { useLinkStatus } from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { usePressable } from "./use-pressable";
import { useKeyboardVisible } from "./use-keyboard-visible";
import { showsBottomNav } from "./visibility";

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
    // Renamed from "Profile" (2026-07 UX audit): the screen is preferences +
    // account management. The route stays /profile (no URL churn).
    href: "/profile",
    label: "Settings",
    icon: (
      // Gear (1.5px stroke, rounded joins — style-guide §1.4).
      <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" className="h-6 w-6">
        <circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="1.5" />
        <path
          d="M12 3.5v2.2m0 12.6v2.2m8.5-8.5h-2.2M5.7 12H3.5m14.5-6-1.6 1.6M7.6 16.4 6 18m12 0-1.6-1.6M7.6 7.6 6 6"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
        />
      </svg>
    ),
  },
];

/**
 * The tab's visible content, rendered *inside* `<Link>` so it can read
 * `useLinkStatus()`.
 *
 * `pending` is the whole point: these routes are server-rendered against
 * Supabase, so the gap between tap and paint is real network time. Treating a
 * pending tab as selected means the destination lights up on tap — the answer
 * to "did that register?" arrives immediately and is *correct*, rather than
 * waiting for the server. If the navigation is instant, `pending` never flips
 * and `active` has already taken over; if it is aborted, `pending` falls back
 * to false on its own. No optimistic state to reconcile by hand.
 */
function TabContent({ tab, active }: { tab: Tab; active: boolean }) {
  const { pending } = useLinkStatus();
  const on = active || pending;

  return (
    <span
      className={[
        "relative z-[1] flex flex-col items-center gap-1",
        on ? "text-accent" : "text-silver group-hover:text-chalk",
      ].join(" ")}
    >
      {tab.icon}
      <span className="font-body">{tab.label}</span>
      {/* Selected marker. Selection used to be carried by colour ALONE, and
          accent-against-Silver is a 1.57:1 luminance pair in dark and 1.03:1
          in light — i.e. for a user who does not separate those two hues, the
          tabs were indistinguishable (WCAG 1.4.1, "use of colour"). A shape
          that is present or absent is a second, non-chromatic channel, and it
          doubles as the at-a-glance answer during the pending window. */}
      <span
        aria-hidden="true"
        className={[
          "absolute -bottom-1.5 h-1 w-1 rounded-full bg-accent",
          "transition-opacity duration-200 motion-reduce:transition-none",
          on ? "opacity-100" : "opacity-0",
        ].join(" ")}
      />
    </span>
  );
}

function NavTab({ tab, active }: { tab: Tab; active: boolean }) {
  const { pressed, handlers } = usePressable();

  return (
    <Link
      href={tab.href}
      // Prefetch is left at the default (automatic), NOT forced to `true`.
      // All three tabs are dynamic routes (the app layout reads cookies), and
      // automatic prefetch warms each one down to its `loading.tsx` boundary —
      // which is what actually makes the transition instant. Forcing a full
      // prefetch would additionally run every route's Supabase queries on each
      // page view, and Next 15 defaults `staleTimes.dynamic` to 0, so that
      // payload is discarded rather than reused. Triple the reads, no gain.
      aria-current={active ? "page" : undefined}
      data-pressed={pressed || undefined}
      {...handlers}
      className={[
        "nav-tab group flex flex-1 min-h-[var(--bottom-nav-h)] flex-col items-center justify-center py-2",
        // select-none stops iOS long-press from selecting the tab label
        // instead of navigating.
        "select-none text-xs",
      ].join(" ")}
    >
      <TabContent tab={tab} active={active} />
    </Link>
  );
}

export function BottomNav() {
  const pathname = usePathname();
  // iOS keeps "fixed" chrome anchored to the layout viewport, so with the
  // software keyboard open the bar would float mid-screen over the content
  // being edited. Slide it off-screen while the keyboard is up instead —
  // the tabs are unreachable behind the keyboard anyway.
  const keyboardVisible = useKeyboardVisible();

  // The auth gate + onboarding screens show only the brand — no nav. Keyed off
  // the shared predicate so the scroll region's reservation stays in agreement.
  if (!showsBottomNav(pathname)) {
    return null;
  }

  return (
    <nav
      aria-label="Primary"
      // inert (Safari 15.5+) removes the slid-away bar from both the a11y
      // tree and tab order — stronger than aria-hidden on focusable content.
      inert={keyboardVisible || undefined}
      className={[
        "glass-nav fixed inset-x-0 bottom-0 z-50 pb-safe",
        "transition-transform duration-200",
        keyboardVisible ? "pointer-events-none translate-y-full" : "translate-y-0",
      ].join(" ")}
    >
      <ul className="mx-auto flex max-w-screen-sm items-stretch justify-around">
        {TABS.map((tab) => (
          <li key={tab.href} className="flex flex-1">
            <NavTab
              tab={tab}
              active={pathname === tab.href || pathname.startsWith(`${tab.href}/`)}
            />
          </li>
        ))}
      </ul>
    </nav>
  );
}
