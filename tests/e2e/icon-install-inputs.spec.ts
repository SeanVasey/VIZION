import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { test, expect } from "@playwright/test";
import sharp from "sharp";

// This checks Next's actual responses and hydrated metadata, not iOS selection.
test("installation inputs remain singular, authentic and revalidating", async ({
  page,
  request,
}) => {
  const raw = await request.get("/sign-in", { maxRedirects: 0 });
  expect(raw.status()).toBe(200);
  const html = await raw.text();
  expect(html.match(/<link\b[^>]*rel="manifest"[^>]*>/g)).toHaveLength(1);
  expect(html.match(/<link\b[^>]*rel="apple-touch-icon"[^>]*>/g)).toHaveLength(1);

  // This covers the unauthenticated real installation entry point as well.
  await page.goto("/");
  await expect(page).toHaveURL(/\/sign-in$/);
  await page.waitForFunction(() =>
    document.querySelector('meta[name="apple-mobile-web-app-status-bar-style"]'),
  );
  const readLinks = () =>
    page.locator("head link[rel]").evaluateAll((links) =>
      links
        .filter((link) =>
          ["manifest", "icon", "apple-touch-icon"].includes(
            link.getAttribute("rel") || "",
          ),
        )
        .map((link) => ({
          rel: link.getAttribute("rel"),
          href: link.getAttribute("href"),
          media: link.getAttribute("media"),
          credentials: link.getAttribute("crossorigin"),
        })),
    );
  const initial = await readLinks();
  const apple = initial.filter((link) => link.rel === "apple-touch-icon");
  const manifests = initial.filter((link) => link.rel === "manifest");
  expect(apple).toHaveLength(1);
  expect(apple[0]?.href).toBe("/icons/apple-touch-icon.png");
  expect(apple[0]?.media).toBeNull();
  expect(manifests).toHaveLength(1);
  expect(manifests[0]?.href).toBe("/manifest.webmanifest");
  expect(manifests[0]?.credentials).toBe("use-credentials");
  for (const colorScheme of ["dark", "light"] as const) {
    await page.emulateMedia({ colorScheme });
    expect(await readLinks()).toEqual(initial);
  }

  const manifestResponse = await request.get("/manifest.webmanifest", {
    maxRedirects: 0,
  });
  expect(manifestResponse.status()).toBe(200);
  expect(manifestResponse.headers()["content-type"]).toMatch(
    /application\/(manifest\+)?json/,
  );
  const manifestBytes = await manifestResponse.body();
  expect(manifestBytes).toEqual(readFileSync(resolve("public/manifest.webmanifest")));
  const manifest = JSON.parse(manifestBytes.toString("utf8"));
  expect(manifest).toMatchObject({ id: "/", start_url: "/?source=pwa", scope: "/" });

  const candidates = new Set<string>([
    ...initial
      .filter((link) => link.rel !== "manifest")
      .map((link) => link.href as string),
    ...manifest.icons.map((icon: { src: string }) => icon.src),
  ]);
  for (const href of candidates) {
    // Refuse external or traversal paths before mapping them to local files.
    expect(href).toMatch(/^\/icons\/[a-z0-9-]+\.(png|svg)$/);
    const response = await request.get(href, { maxRedirects: 0 });
    expect(response.status(), href).toBe(200);
    expect(response.headers()["content-type"], href).toMatch(
      href.endsWith(".svg") ? /^image\/svg\+xml/ : /^image\/png/,
    );
    const bytes = await response.body();
    const expectedBytes = readFileSync(resolve(`public${href}`));
    const hash = (buffer: Buffer) => createHash("sha256").update(buffer).digest("hex");
    expect(hash(bytes), href).toBe(hash(expectedBytes));
    const metadata = await sharp(bytes).metadata();
    expect(metadata.width, href).toBe(metadata.height);
    expect(metadata.width, href).toBeGreaterThan(0);
    if (["/icons/app-icon.svg", "/icons/apple-touch-icon.png"].includes(href)) {
      expect(response.headers()["cache-control"], href).toBe(
        "public, max-age=0, must-revalidate",
      );
    }
    expect(response.headers()["x-content-type-options"]).toBe("nosniff");
  }
  // General icons retain their existing policy; do not broaden this repair.
  const other = await request.get("/icons/icon-192.png");
  expect(other.headers()["cache-control"]).toBe(
    "public, max-age=86400, stale-while-revalidate=604800",
  );
});
