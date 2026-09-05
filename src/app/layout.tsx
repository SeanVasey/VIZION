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
// Share artwork. Both are generated in-canon from tokens.css + the master glyph
// by scripts/generate-social-card.mjs, so neither can disagree with the brand
// green.
//
//   OG_TILE      1200×1200, Void mark on a Laser plate — the house colorway,
//                as on the favicons. Installed tiles use the outlined mark.
//                This is `og:image`, and it is SQUARE on
//                purpose: every consumer of og:image except X crops toward a
//                square. iOS Safari's Share Sheet takes the centre 640×640,
//                which of the landscape card kept only the right arm of the
//                chevron and a half-sentence. A square source has no crop to
//                survive.
//   SOCIAL_CARD  1280×640, the full descriptive card. Now `twitter:image` only
//                (X reads it ahead of og:image and genuinely wants 2:1), plus
//                the GitHub → Settings → Social preview upload.
const OG_TILE = "/brand/og-tile.png";
const SOCIAL_CARD = "/brand/social-card.png";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  applicationName: "VIZION",
  title: {
    default: "VIZION — prompt-engineering studio",
    template: "%s · VIZION",
  },
  description: DESCRIPTION,
  // NO `manifest` key: the link is hand-written in <head> below, because it
  // needs a `crossorigin` attribute the Metadata API cannot express.
  openGraph: {
    type: "website",
    siteName: "VIZION",
    title: "VIZION — prompt-engineering studio",
    description: DESCRIPTION,
    url: "/",
    images: [
      {
        url: OG_TILE,
        width: 1200,
        height: 1200,
        alt: "The VIZION mark — a chevron framing a bar and split ring, on brand green",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "VIZION — prompt-engineering studio",
    description: DESCRIPTION,
    images: [SOCIAL_CARD],
  },
  /**
   * All icon links are explicit. The generator writes to public/icons; no
   * App Router convention icon files are used alongside this declaration.
   *
   * Production keeps ONE unconditional outlined Apple touch PNG. WebKit
   * documents that an explicit apple-touch-icon takes precedence over
   * manifest icons on iOS. It is not a fallback to the SVG below. The flat
   * Laser plate and the Void-outlined glyph, filled darker than the plate, are
   * intended to retain contrast when iOS treats the installed background
   * differently.
   *
   * The adaptive SVG is offered to SVG-aware icon consumers. Its order here
   * or in the manifest does not prove iPhone selection, and its CSS rendering
   * does not establish live Home Screen updates. Source-selection variants
   * remain in the isolated harness until physical-device acceptance.
   *
   * See docs/runbooks/icon-install-repair.md for the current evidence contract.
   * Do not pin the tile dark, add a theme-switching Apple-link component, or
   * change app identity to refresh an installation. Favicons stay unchanged.
   */
  icons: {
    icon: [
      { url: "/icons/app-icon.svg", type: "image/svg+xml" },
      { url: "/icons/favicon-32.png", type: "image/png", sizes: "32x32" },
      { url: "/icons/favicon-16.png", type: "image/png", sizes: "16x16" },
    ],
    apple: [{ url: "/icons/apple-touch-icon.png", sizes: "180x180" }],
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
        {/* The manifest link, WITH credentials. Per the Web App Manifest spec a
            manifest is fetched with credentials OMITTED unless the link says
            `crossorigin="use-credentials"` — cookies stay home even for a
            same-origin URL. Vercel's Deployment Protection on preview builds
            is a cookie (`_vercel_jwt`), so on every preview the browser could
            read the page and NOT the manifest: the fetch was 302-redirected to
            Vercel's SSO page (measured on this branch's preview, 2026-09-04),
            the manifest was silently discarded, and everything it
            declares — the app's NAME for the Home Screen, its icons, standalone
            display — fell back to whatever the install flow uses without one.
            That is the shape of "Add to Home Screen shows the page's title
            (route first) instead of VIZION". Production carries no such cookie
            and is unaffected either way; `use-credentials` on a same-origin
            link costs nothing there. Hand-written rather than `metadata.manifest`
            because the Metadata API renders the link without attributes, and a
            second manifest link would only ever be ignored (first one wins). */}
        <link rel="manifest" href="/manifest.webmanifest" crossOrigin="use-credentials" />
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
