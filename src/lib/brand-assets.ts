/**
 * Versioned URL for the in-app app-icon tile in `public/brand/`.
 *
 * Only the header tile is served as a file. The brand MARK is inlined instead
 * (`src/components/BrandMark.tsx`) so it can take `currentColor` and follow the
 * theme — an <img> cannot be recoloured per scheme. That is why there is no
 * longer a `BRAND_MARK_SRC` here.
 *
 * The tile is `vizion-icon-light.svg`, the composed Light appearance. Composed
 * — not the flat plate the PNG derivatives are built from — because nothing
 * masks an <img> in a web document: here the baked squircle and its gradient
 * are the point, and they are what the user already sees on the home screen
 * once iOS has rounded and glassified the flat tile. (The inverse rule governs
 * the derivatives: `scripts/generate-icons.mjs` must NEVER rasterize this file,
 * or the OS would round already-rounded corners.)
 *
 * The master keeps its stable filename — the docs and the icon matrix key off
 * these names ("swap the source content, not the filenames",
 * tasks/lessons.md). But a stable name meets two
 * stale-while-revalidate layers in front of the live DOM: the `/brand/:path*`
 * HTTP policy (next.config.ts, a day fresh + a week served-stale) sits UNDER
 * the service worker's StaleWhileRevalidate image route, whose background
 * refetch reads the still-fresh HTTP cache rather than the network. Re-cut
 * artwork published at the same URL can therefore stay stale on returning
 * devices for days after a deploy — the header was still painting the
 * pre-re-cut app icon a day after the swap shipped.
 *
 * The `?v=` query gives changed art a changed URL — a cold key in the browser
 * and SW caches at once, with no filename churn. Bump the version in the same
 * commit as any change to a `public/brand/` master. (`next/image` still
 * treats a query-suffixed `.svg` as unoptimized SVG passthrough — it strips
 * the query before the extension check.)
 */
const BRAND_ASSET_VERSION = "2";

export const BRAND_ICON_SRC = `/brand/vizion-icon-light.svg?v=${BRAND_ASSET_VERSION}`;
