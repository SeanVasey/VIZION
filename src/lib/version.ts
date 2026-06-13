/**
 * App version, sourced from package.json at build via next.config.ts
 * (`env: { NEXT_PUBLIC_APP_VERSION }`).  Never hardcode the version — the brand
 * pills (R1) and footer (R7) both read it from here.
 */
export const APP_VERSION = process.env.NEXT_PUBLIC_APP_VERSION ?? "0.0.0";
