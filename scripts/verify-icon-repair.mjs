// Read-only asset checks plus disposable, outside-repository diagnostic builds.
// This verifies authored pixels and installation inputs, not iOS icon services.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import sharp from "sharp";
import { ANY_SIZES, installedColorway } from "./generate-icons.mjs";
import { buildIconDiagnostic, serveIconDiagnostic } from "./icon-diagnostic.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => fs.readFile(path.join(ROOT, rel));
const hash = (data) => createHash("sha256").update(data).digest("hex");
const rgba = (hex) => [
  ...hex
    .slice(1)
    .match(/../g)
    .map((v) => parseInt(v, 16)),
  255,
];
const raw = async (data, size) => {
  let image = sharp(data);
  if (size) image = image.resize(size, size, { fit: "fill" });
  return image.ensureAlpha().raw().toBuffer({ resolveWithObject: true });
};
function pixel(image, x, y) {
  const offset = (y * image.info.width + x) * 4;
  return [...image.data.subarray(offset, offset + 4)];
}

export async function verifyIconRepair() {
  const checks = [];
  const check = async (name, run) => {
    await run();
    checks.push(name);
  };
  const source = (await read("public/brand/vizion-glyph.svg")).toString();
  const svg = (await read("public/icons/app-icon.svg")).toString();
  const tokens = (await read("src/styles/tokens.css")).toString();
  const c = installedColorway();
  const plate = rgba(c.plate);
  const d = source.match(/<path[^>]*\sd="([^"]+)"/)?.[1];
  const paths = [...svg.matchAll(/<path\b[^>]*>/g)].map((m) => m[0]);
  const rect = svg.match(/<rect\b[^>]*>/)?.[0];
  const stripped = svg.replace(/<style>.*?<\/style>/gs, "");
  const foreground = stripped.replace(/<rect\b[^>]*\/>/g, "");
  await check(
    "canonical geometry and positioning: one flat mark path, no outline",
    async () => {
      assert(d, "Master glyph path is missing");
      // Amendment 5: the installed tile is the flat Laser mark alone on the
      // shaded plate — ONE path, no outline, no gradient.
      assert.equal(paths.length, 1);
      assert.equal(paths[0].match(/\sd="([^"]+)"/)?.[1], d);
      assert(paths[0].includes(`fill="${c.mark}"`));
      assert.match(paths[0], /fill-rule="evenodd"/);
      assert(!paths[0].includes("stroke="));
      assert(!svg.includes('<linearGradient id="mark"'));
      assert(svg.includes('transform="translate(133.12,165.69) scale(0.74000)"'));
      assert(!/<(?:clipPath|filter)\b|\srx=|<image\b/.test(svg));
      assert(svg.includes('viewBox="0 0 1024 1024"'));
    },
  );
  await check(
    "token-derived presentation fallback with an overridable CSS class",
    async () => {
      // The MARK is the Laser token; the PLATE is Laser shaded toward Void and
      // must differ from the mark (iOS keeps only mark pixels distinct from
      // the plate); the outline the `any` matrix keeps is the Void token.
      assert.equal(c.mark, tokens.match(/--laser:\s*(#[0-9a-f]+)/i)?.[1]?.toUpperCase());
      assert.notEqual(c.plate, c.mark);
      assert.equal(
        c.outline,
        tokens.match(/--void:\s*(#[0-9a-f]+)/i)?.[1]?.toUpperCase(),
      );
      assert(rect?.includes(`fill="${c.plate}"`));
      assert(rect?.includes('class="plate"'));
      assert(!/\sstyle=/.test(rect));
      assert(svg.includes(`.plate{fill:${c.plate}}`));
      assert(
        svg.includes("@media (prefers-color-scheme:dark){.plate{fill:url(#plate-dark)}}"),
      );
    },
  );
  await check(
    "stripped-style fallback paints the shaded plate at 60, 120 and 180 pixels",
    async () => {
      for (const size of [60, 120, 180]) {
        const image = await raw(Buffer.from(stripped), size);
        for (const [x, y] of [
          [1, 1],
          [size - 2, 1],
          [1, size - 2],
          [size - 2, size - 2],
        ]) {
          assert.deepEqual(pixel(image, x, y), plate);
        }
        // Red/green control: the old missing-attribute fixture has a black plate.
        const old = stripped.replace(` fill="${c.plate}"`, "");
        assert.notDeepEqual(pixel(await raw(Buffer.from(old), size), 1, 1), plate);
      }
    },
  );
  await check("Apple PNG pixels equal the authored light fallback", async () => {
    const apple = await raw(await read("public/icons/apple-touch-icon.png"));
    assert.equal(apple.info.width, 180);
    assert.equal(apple.info.height, 180);
    const expected = await raw(Buffer.from(stripped), 180);
    assert.deepEqual(apple.data, expected.data);
    for (let i = 3; i < apple.data.length; i += 4) assert.equal(apple.data[i], 255);
  });
  await check(
    "transparent export dimensions, antialiasing and unclipped borders",
    async () => {
      for (const size of ANY_SIZES) {
        const image = await raw(await read(`public/icons/icon-${size}.png`));
        assert.equal(image.info.width, size);
        assert.equal(image.info.height, size);
        let opaque = 0,
          intermediate = 0;
        for (let y = 0; y < size; y++) {
          for (let x = 0; x < size; x++) {
            const a = image.data[(y * size + x) * 4 + 3];
            if (a === 255) opaque++;
            if (a > 0 && a < 255) intermediate++;
            if (x === 0 || y === 0 || x === size - 1 || y === size - 1)
              assert.equal(a, 0);
          }
        }
        assert(opaque > size && intermediate > size);
      }
    },
  );
  await check(
    "maskable exports are opaque and their artwork clears the safe circle",
    async () => {
      for (const size of [192, 512]) {
        const image = await raw(await read(`public/icons/maskable-${size}.png`));
        assert.equal(image.info.width, size);
        assert.equal(image.info.height, size);
        for (let y = 0; y < size; y++) {
          for (let x = 0; x < size; x++) {
            const p = pixel(image, x, y);
            assert.equal(p[3], 255);
            // Ignore tiny reconstruction-kernel fringes, not visible artwork.
            if (p.slice(0, 3).some((v, k) => Math.abs(v - plate[k]) > 3)) {
              assert(Math.hypot(x + 0.5 - size / 2, y + 0.5 - size / 2) <= size * 0.4);
            }
          }
        }
      }
    },
  );
  await check(
    "opaque mark pixels do not change across authored backgrounds",
    async () => {
      const mask = await raw(Buffer.from(foreground), 180);
      const light = await raw(Buffer.from(stripped), 180);
      // Explicit authored fixture, not a simulated iOS darkening algorithm.
      const dark = await raw(
        Buffer.from(stripped.replace(`fill="${c.plate}"`, 'fill="url(#plate-dark)"')),
        180,
      );
      let compared = 0;
      for (let i = 0; i < mask.data.length; i += 4) {
        if (mask.data[i + 3] !== 255) continue;
        for (let channel = 0; channel < 3; channel++) {
          // Resize kernels can pull in neighboring background at boundary pixels.
          if (Math.abs(mask.data[i + channel] - light.data[i + channel]) > 2) continue;
          assert(Math.abs(light.data[i + channel] - dark.data[i + channel]) <= 2);
        }
        compared++;
      }
      assert(compared > 2000);
    },
  );
  await check("manifest identity and every declared icon remain valid", async () => {
    const manifest = JSON.parse((await read("public/manifest.webmanifest")).toString());
    assert.equal(manifest.id, "/");
    assert.equal(manifest.start_url, "/?source=pwa");
    assert.equal(manifest.scope, "/");
    for (const icon of manifest.icons) {
      assert(/^\/icons\/[a-z0-9-]+\.(svg|png)$/.test(icon.src));
      assert(["any", "maskable"].includes(icon.purpose));
      const bytes = await read(`public${icon.src}`);
      const meta = await sharp(bytes).metadata();
      if (icon.sizes !== "any") assert.equal(icon.sizes, `${meta.width}x${meta.height}`);
      assert.equal(icon.type, icon.src.endsWith(".svg") ? "image/svg+xml" : "image/png");
    }
  });
  await check(
    "isolated diagnostic is deterministic, source-distinct and correctly served",
    async () => {
      const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "vizion-icon-test-"));
      let server;
      try {
        // Test-only sentinel, explicitly not a release commit or device result.
        const baseSha = "0".repeat(40);
        const a = await buildIconDiagnostic({ outDir: path.join(tmp, "one"), baseSha });
        const b = await buildIconDiagnostic({ outDir: path.join(tmp, "two"), baseSha });
        assert.equal(a.version, b.version);
        assert.deepEqual(a.files, b.files);
        const ids = new Set();
        for (const c of a.cases) {
          const html = await fs.readFile(
            path.join(a.outDir, c.key, "index.html"),
            "utf8",
          );
          const manifest = JSON.parse(
            await fs.readFile(path.join(a.outDir, c.key, "manifest.webmanifest"), "utf8"),
          );
          ids.add(manifest.id);
          assert.equal(manifest.icons.length, 1);
          assert.equal(manifest.icons[0].src, c.icon);
          assert(manifest.start_url.startsWith(`/${c.key}/`));
          assert.equal(manifest.scope, `/${c.key}/`);
          assert(
            !html.includes("/_next/") && !html.includes('href="/manifest.webmanifest"'),
          );
          assert.equal(
            (html.match(/rel="apple-touch-icon"/g) || []).length,
            c.apple ? 1 : 0,
          );
          assert.equal((html.match(/rel="icon"/g) || []).length, 0);
        }
        assert.equal(ids.size, 3);
        assert.notEqual(a.cases[2].apple, a.cases[2].icon);
        assert(
          !Object.keys(a.files).some((p) => /^\/(apple-touch|sw\.js|favicon)/.test(p)),
        );
        for (const [rel, expected] of Object.entries(a.files)) {
          assert.equal(
            hash(await fs.readFile(path.join(a.outDir, rel.slice(1)))),
            expected.sha256,
          );
        }
        await assert.rejects(
          buildIconDiagnostic({
            outDir: path.join(ROOT, "public", "icon-test"),
            baseSha,
          }),
        );
        await assert.rejects(buildIconDiagnostic({ outDir: a.outDir, baseSha }));
        server = await serveIconDiagnostic({ directory: a.outDir, port: 0 });
        const address = server.address();
        assert(address && typeof address !== "string");
        const origin = `http://127.0.0.1:${address.port}`;
        for (const c of a.cases) {
          const r = await fetch(`${origin}/${c.key}/`, { redirect: "error" });
          assert.equal(r.status, 200);
          assert(r.headers.get("content-type").startsWith("text/html"));
          for (const p of new Set([c.icon, c.apple].filter(Boolean))) {
            const response = await fetch(origin + p, { redirect: "error" });
            assert.equal(response.status, 200);
            assert.equal(response.headers.get("cache-control"), "no-store");
            assert.equal(response.headers.get("content-type"), a.files[p].type);
            assert.equal(
              hash(Buffer.from(await response.arrayBuffer())),
              a.files[p].sha256,
            );
          }
        }
        for (const p of [
          "/apple-touch-icon.png",
          "/apple-touch-icon-precomposed.png",
          "/apple-touch-icon-180x180.png",
          "/manifest.webmanifest",
          "/sw.js",
          "/favicon.ico",
          "/b/missing.png",
          "/%2e%2e/package.json",
        ]) {
          assert.equal((await fetch(origin + p, { redirect: "error" })).status, 404);
        }
      } finally {
        if (server)
          await new Promise((resolve, reject) =>
            server.close((e) => (e ? reject(e) : resolve())),
          );
        await fs.rm(tmp, { recursive: true, force: true });
      }
    },
  );
  return {
    status: "passed",
    checks,
    node: process.version,
    sharp: sharp.versions,
    scope:
      "Authored assets and isolated local HTTP diagnostic only; no Next.js application gate or iPhone acceptance is implied",
  };
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
  try {
    console.log(JSON.stringify(await verifyIconRepair(), null, 2));
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  }
}
