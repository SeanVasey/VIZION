import type { Metadata, Viewport } from "next";
import { Bebas_Neue, Reddit_Sans, JetBrains_Mono } from "next/font/google";
import "@/styles/globals.css";
import { UI_STORE_KEY } from "@/lib/constants";
import { QueryProvider } from "@/lib/query/provider";
import { ThemeManager } from "@/components/ThemeManager";
import { SafeAreaProvider } from "@/components/nav/SafeAreaProvider";
import { BottomNav } from "@/components/nav/BottomNav";

const display = Bebas_Neue({
  weight: "400",
  subsets: ["latin"],
  variable: "--font-display",
  display: "swap",
  fallback: ["Arial Narrow", "sans-serif"],
});

const body = Reddit_Sans({
  weight: ["400", "500", "600", "700"],
  subsets: ["latin"],
  variable: "--font-body",
  display: "swap",
  fallback: ["system-ui", "sans-serif"],
});

const mono = JetBrains_Mono({
  weight: ["400", "500", "700"],
  subsets: ["latin"],
  variable: "--font-mono",
  display: "swap",
  fallback: ["ui-monospace", "monospace"],
});

export const metadata: Metadata = {
  applicationName: "VIZ(IO)N",
  title: {
    default: "VIZ(IO)N — prompt-engineering studio",
    template: "%s · VIZ(IO)N",
  },
  description:
    "A VASEY/AI prompt-engineering studio — clarify, expand, condense, reformat, and re-target prompts for Opus, GPT, and Gemini.",
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    title: "VIZ(IO)N",
    statusBarStyle: "black-translucent",
  },
  formatDetection: { telephone: false },
};

export const viewport: Viewport = {
  themeColor: "#0F1012",
  width: "device-width",
  initialScale: 1,
  maximumScale: 5,
  viewportFit: "cover",
};

/** Set <html data-theme> before first paint to avoid a theme flash. */
const NO_FLASH = `(function(){try{var r=localStorage.getItem("${UI_STORE_KEY}");var t=r?JSON.parse(r).state.theme:"system";document.documentElement.dataset.theme=t||"system";}catch(e){document.documentElement.dataset.theme="system";}})();`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="en"
      data-theme="system"
      className={`${display.variable} ${body.variable} ${mono.variable}`}
      suppressHydrationWarning
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: NO_FLASH }} />
      </head>
      <body>
        <a
          href="#main-content"
          className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-[100] focus:rounded-lg focus:bg-laser focus:px-3 focus:py-2 focus:text-void"
        >
          Skip to content
        </a>
        <QueryProvider>
          <ThemeManager />
          <SafeAreaProvider>{children}</SafeAreaProvider>
          <BottomNav />
        </QueryProvider>
      </body>
    </html>
  );
}
