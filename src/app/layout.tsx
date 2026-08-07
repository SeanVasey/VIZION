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

export const metadata: Metadata = {
  applicationName: "VIZION",
  title: {
    default: "VIZION — prompt-engineering studio",
    template: "%s · VIZION",
  },
  description:
    "A VASEY/AI prompt-engineering studio — polish, clarify, expand, condense, reformat, and re-target prompts across sixteen target models from twelve AI developers.",
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    title: "VIZION",
    statusBarStyle: "black-translucent",
  },
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
