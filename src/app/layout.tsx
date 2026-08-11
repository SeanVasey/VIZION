import type { Metadata, Viewport } from "next";
import { headers } from "next/headers";
import "@/styles/globals.css";
import { bebasNeue, redditSans, jetBrainsMono } from "@/app/fonts";
import { UI_STORE_KEY } from "@/lib/constants";
import { QueryProvider } from "@/lib/query/provider";
import { ThemeManager } from "@/components/ThemeManager";
import { ReducedEffectsManager } from "@/components/ReducedEffectsManager";
import { ScrollStateManager } from "@/components/ScrollStateManager";
import { AmbientNebula } from "@/components/background/AmbientNebula";
import { SafeAreaProvider } from "@/components/nav/SafeAreaProvider";
import { BottomNav } from "@/components/nav/BottomNav";

const fontVars = `${bebasNeue.variable} ${redditSans.variable} ${jetBrainsMono.variable}`;

// One canonical origin for absolute metadata URLs (Open Graph / Twitter card
// images resolve against `metadataBase`). Overridable per deploy; the fallback
// is the documented production domain (docs/runbooks/shortcuts.md).
// `||`, not `??`: `.env.example` ships `NEXT_PUBLIC_SITE_URL=` empty, so a
// copied-but-unfilled var surfaces as "" (not undefined) — and an empty string
// must fall back too, or `new URL("")` below throws at module eval and crashes
// every route.
const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || "https://vizion-io.vercel.app";
const DESCRIPTION =
  "A VASEY/AI prompt-engineering studio — polish, clarify, expand, condense, reformat, and re-target prompts across sixteen target models from twelve AI developers.";
// The share/"template" card. Generated in-canon from tokens.css + the master
// glyph by scripts/generate-social-card.mjs, so it can never disagree with the
// brand green (1280×640 is GitHub's and the OG spec's large-card ratio).
const SOCIAL_CARD = "/brand/social-card.png";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  applicationName: "VIZION",
  title: {
    default: "VIZION — prompt-engineering studio",
    template: "%s · VIZION",
  },
  description: DESCRIPTION,
  manifest: "/manifest.webmanifest",
  openGraph: {
    type: "website",
    siteName: "VIZION",
    title: "VIZION — prompt-engineering studio",
    description: DESCRIPTION,
    url: "/",
    images: [
      {
        url: SOCIAL_CARD,
        width: 1280,
        height: 640,
        alt: "VIZION — a VASEY/AI prompt-engineering studio",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "VIZION — prompt-engineering studio",
    description: DESCRIPTION,
    images: [SOCIAL_CARD],
  },
  // NO appleWebApp block: the two static apple metas are hand-written in the
  // <head> below. metadata.appleWebApp — even without statusBarStyle — makes
  // React OWN an apple-mobile-web-app-status-bar-style tag and re-insert it
  // after ThemeManager's correction, leaving two contradictory tags with the
  // stale one last (audit VAR-02; measured both ways: statusBarStyle set
  // duplicated under a light scheme, unset duplicated under dark).
  // ThemeManager is the single writer of that tag (create-when-absent).
  // Launch-time iOS behavior without a static tag is unverifiable here; see
  // docs/runbooks/ios-verification.md.
  formatDetection: { telephone: false },
};

export const viewport: Viewport = {
  // Media-qualified pair (DSN-002 / PWA-08): the OS chrome tint follows the
  // theme instead of always reading the dark Void. Values are the dark/light
  // page backgrounds from tokens.css (--bg).
  themeColor: [
    { media: "(prefers-color-scheme: dark)", color: "#0F1012" },
    { media: "(prefers-color-scheme: light)", color: "#EEF0F4" },
  ],
  width: "device-width",
  initialScale: 1,
  maximumScale: 5,
  viewportFit: "cover",
};

/** Set <html data-theme> before first paint to avoid a theme flash. */
const NO_FLASH = `(function(){try{var r=localStorage.getItem("${UI_STORE_KEY}");var t=r?JSON.parse(r).state.theme:"system";document.documentElement.dataset.theme=t||"system";}catch(e){document.documentElement.dataset.theme="system";}})();`;

/**
 * iOS Home-Screen launch images (`apple-touch-startup-image`, PRI-007 / APPLE-01).
 *
 * Each entry pairs a device's CSS viewport + pixel ratio with the splash PNG
 * `scripts/generate-icons.mjs` renders for it, so the media query resolves to
 * exactly one image. iPhone XR/11 (dpr 2) and XS Max/11 Pro Max (dpr 3) share
 * 414×896 CSS px, so the `-webkit-device-pixel-ratio` clause is what separates
 * them. Portrait only — the manifest is portrait-locked. Without these links the
 * 528 KB splash set shipped and was never referenced.
 */
const SPLASH_SCREENS = [
  { w: 430, h: 932, dpr: 3, file: "splash-1290x2796.png" },
  { w: 393, h: 852, dpr: 3, file: "splash-1179x2556.png" },
  { w: 390, h: 844, dpr: 3, file: "splash-1170x2532.png" },
  { w: 428, h: 926, dpr: 3, file: "splash-1284x2778.png" },
  { w: 375, h: 812, dpr: 3, file: "splash-1125x2436.png" },
  { w: 414, h: 896, dpr: 2, file: "splash-828x1792.png" },
  { w: 414, h: 896, dpr: 3, file: "splash-1242x2688.png" },
  { w: 768, h: 1024, dpr: 2, file: "splash-1536x2048.png" },
  { w: 834, h: 1194, dpr: 2, file: "splash-1668x2388.png" },
  { w: 1024, h: 1366, dpr: 2, file: "splash-2048x2732.png" },
];

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // The middleware's per-request CSP nonce (audit SEC-001): without it on this
  // script, the nonce policy would block the theme bootstrap and every load
  // would flash. Reading headers() makes the layout dynamic — every document
  // is middleware-rendered already, so nothing static is lost but the "/"
  // redirect shell.
  const nonce = (await headers()).get("x-nonce") ?? undefined;
  return (
    <html
      lang="en"
      data-theme="system"
      // Declares the `scroll-behavior: smooth` set in globals.css. Next reads
      // this to decide whether it must neutralize smooth scrolling around its
      // own scroll restoration — without it, route changes would animate their
      // scroll-to-top from v16 on, and dev logs a warning today.
      data-scroll-behavior="smooth"
      className={fontVars}
      suppressHydrationWarning
    >
      <head>
        {/* Hand-written so React's metadata system never owns a status-bar
            tag (see the metadata comment above — audit VAR-02). */}
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-title" content="VIZION" />
        <script nonce={nonce} dangerouslySetInnerHTML={{ __html: NO_FLASH }} />
        {/* iOS Home-Screen launch images — one per device class (PRI-007). */}
        {SPLASH_SCREENS.map((s) => (
          <link
            key={s.file}
            rel="apple-touch-startup-image"
            media={`(device-width: ${s.w}px) and (device-height: ${s.h}px) and (-webkit-device-pixel-ratio: ${s.dpr}) and (orientation: portrait)`}
            href={`/splash/${s.file}`}
          />
        ))}
      </head>
      <body>
        <a
          href="#main-content"
          className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-[100] focus:rounded-lg focus:bg-laser focus:px-3 focus:py-2 focus:text-on-laser"
        >
          Skip to content
        </a>
        <QueryProvider>
          <ThemeManager />
          <ReducedEffectsManager />
          <ScrollStateManager />
          <AmbientNebula />
          <SafeAreaProvider>{children}</SafeAreaProvider>
          <BottomNav />
        </QueryProvider>
      </body>
    </html>
  );
}
