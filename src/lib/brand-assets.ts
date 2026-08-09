/**
 * Versioned URLs for the brand-master SVGs in `public/brand/`.
 *
 * The masters keep their stable filenames — `scripts/generate-icons.mjs`, the
 * docs and the icon matrix all key off them ("swap the source content, not
 * the filenames", tasks/lessons.md). But a stable name meets two
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

export const BRAND_ICON_SRC = `/brand/vizion-icon-token.svg?v=${BRAND_ASSET_VERSION}`;
export const BRAND_MARK_SRC = `/brand/vizion-mark-token.svg?v=${BRAND_ASSET_VERSION}`;
