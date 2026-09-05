// Isolated static installation probes. Never copy the output into public/.
// Build outside this repository and serve on a dedicated, unused origin.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { createServer } from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import sharp from "sharp";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const digest = (data) => createHash("sha256").update(data).digest("hex");
const escapeHtml = (value) =>
  String(value).replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c],
  );
const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
};
const CSP =
  "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self'; " +
  "connect-src 'self'; manifest-src 'self'; worker-src 'none'; " +
  "object-src 'none'; base-uri 'none'; frame-ancestors 'none'";

function within(parent, child) {
  const rel = path.relative(parent, child);
  return (
    rel === "" ||
    (!rel.startsWith(`..${path.sep}`) && rel !== ".." && !path.isAbsolute(rel))
  );
}

async function outsideRepository(directory) {
  const target = path.resolve(directory);
  const parent = await fs.realpath(path.dirname(target));
  const real = path.join(parent, path.basename(target));
  assert(
    !within(await fs.realpath(ROOT), real),
    "Diagnostic output must be outside the repository",
  );
  return real;
}

/** Build only. No repository write, network request, deployment, or app identity change. */
export async function buildIconDiagnostic({ outDir, baseSha }) {
  assert(
    typeof outDir === "string" && outDir.length > 0,
    "An output directory is required",
  );
  const sha =
    baseSha ||
    execFileSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8" }).trim();
  assert(/^[a-f0-9]{40}$/.test(sha), "baseSha must be a full, verified Git commit SHA");
  const out = await outsideRepository(outDir);
  // Exclusive creation: do not overwrite a previous experiment or follow a symlink.
  await fs.mkdir(out);
  const read = (rel) => fs.readFile(path.join(ROOT, rel));
  const svgBytes = await read("public/icons/app-icon.svg");
  const png = await read("public/icons/apple-touch-icon.png");
  const glyph = await read("public/brand/vizion-glyph.svg");
  const generator = await read("scripts/generate-icons.mjs");
  const builder = await fs.readFile(fileURLToPath(import.meta.url));
  const svg = svgBytes.toString("utf8");
  assert(svg.includes('class="plate"') && svg.includes("prefers-color-scheme:dark"));
  const version = digest(Buffer.concat([svgBytes, png, glyph, generator, builder])).slice(
    0,
    16,
  );
  const build = {
    schema: 1,
    baseCommit: sha,
    sourceState: "working-tree assets; baseCommit is not a claim of a committed repair",
    version,
    glyphSha256: digest(glyph),
    generatorSha256: digest(generator),
    builderSha256: digest(builder),
    svgSha256: digest(svgBytes),
    applePngSha256: digest(png),
    productionSourceDecision:
      "Keep the explicit outlined Apple PNG; SVG selection remains a device question",
    acceptance: "iOS Home Screen acceptance pending",
    files: {},
  };
  async function put(rel, data) {
    assert(!path.isAbsolute(rel) && !rel.split("/").includes(".."));
    const bytes = Buffer.isBuffer(data) ? data : Buffer.from(data);
    await fs.mkdir(path.dirname(path.join(out, rel)), { recursive: true });
    await fs.writeFile(path.join(out, rel), bytes, { flag: "wx" });
    build.files[`/${rel}`] = {
      sha256: digest(bytes),
      bytes: bytes.length,
      type: MIME[path.extname(rel)] || "text/plain",
    };
  }
  async function asset(label, ext, bytes) {
    const url = `/assets/${label}-${digest(bytes).slice(0, 16)}.${ext}`;
    await put(url.slice(1), bytes);
    return url;
  }
  const aPng = await asset("a-apple", "png", png);
  const preview = await asset("authored-adaptive-preview", "svg", svgBytes);
  // Diagnostic markers are new sibling elements, never changes to the master path.
  const markerStyle =
    "<style>.probe-light{display:inline}.probe-dark{display:none}@media(prefers-color-scheme:dark){.probe-light{display:none}.probe-dark{display:inline}}</style>";
  const bMarkers =
    '<rect class="probe-light" x="300" y="884" width="72" height="72" fill="white" stroke="black" stroke-width="8"/>' +
    '<circle class="probe-dark" display="none" cx="688" cy="920" r="36" fill="white" stroke="black" stroke-width="8"/>';
  const bSvg = await asset(
    "b-svg-branch",
    "svg",
    svg.replace("</svg>", `${markerStyle}${bMarkers}</svg>`),
  );
  const sourcePngMarker =
    '<svg xmlns="http://www.w3.org/2000/svg" width="180" height="180"><rect x="76" y="12" width="28" height="14" fill="white" stroke="black" stroke-width="2"/></svg>';
  const markedPng = await sharp(png)
    .composite([{ input: Buffer.from(sourcePngMarker) }])
    .png()
    .toBuffer();
  const cPng = await asset("c-png-rectangle", "png", markedPng);
  const cSvg = await asset(
    "c-svg-circle",
    "svg",
    svg.replace(
      "</svg>",
      '<circle cx="512" cy="104" r="46" fill="white" stroke="black" stroke-width="10"/></svg>',
    ),
  );
  const cases = [
    {
      key: "a",
      title: "VIZION A PNG",
      apple: aPng,
      icon: aPng,
      type: "image/png",
      sizes: "180x180",
      explanation:
        "Explicit Apple PNG, unchanged outlined artwork. The manifest offers the same PNG. Observe the system's treatment; this does not test live SVG.",
    },
    {
      key: "b",
      title: "VIZION B SVG",
      apple: null,
      icon: bSvg,
      type: "image/svg+xml",
      sizes: "any",
      explanation:
        "Only the manifest SVG is offered. Square at lower left = light CSS branch. Circle at lower right = dark CSS branch. A darker plate alone is not evidence of a branch change. An unsupported installation must be recorded as unsupported.",
    },
    {
      key: "c",
      title: "VIZION C SOURCE",
      apple: cPng,
      icon: cSvg,
      type: "image/svg+xml",
      sizes: "any",
      explanation:
        "Apple PNG has a white rectangle at the top; manifest SVG has a white circle there. WebKit's documented precedence predicts the rectangle. Record the observed marker, not just asset requests.",
    },
  ];
  build.cases = cases;
  const css =
    "html{font-family:system-ui,sans-serif;line-height:1.55;color-scheme:light dark}body{max-width:58rem;margin:2rem auto;padding:0 1.25rem}h1{line-height:1.15}code,pre{overflow-wrap:anywhere;white-space:pre-wrap}section{border:1px solid GrayText;padding:1rem;margin:1.5rem 0}img{width:180px;height:180px;object-fit:contain}a{color:LinkText}dt{font-weight:700;margin-top:.65rem}dd{margin-left:0}#isolation{border:2px solid;padding:.8rem}table{border-collapse:collapse;width:100%}td,th{border:1px solid;padding:.5rem;text-align:left}";
  await put("probe.css", css);
  const browserJs = `async function check(){
  const el=document.getElementById("isolation");
  try{
    if(!isSecureContext)throw Error("Use a dedicated HTTPS preview for representative iPhone installation. HTTP here is for local inspection only.");
    if(location.hostname==="vizion-io.vercel.app")throw Error("Production origin is forbidden for this diagnostic.");
    if("serviceWorker" in navigator){
      const registrations=await navigator.serviceWorker.getRegistrations();
      if(navigator.serviceWorker.controller||registrations.length)throw Error("Existing service worker detected. Use an unused origin. Nothing has been removed.");
    }
    for(const p of ["/apple-touch-icon.png","/apple-touch-icon-precomposed.png","/apple-touch-icon-180x180.png","/favicon.ico","/manifest.webmanifest","/sw.js"]){
      const r=await fetch(p,{cache:"no-store",credentials:"include",redirect:"error"});
      if(r.status!==404)throw Error("Unexpected root fallback or interception: "+p+" returned "+r.status);
    }
    const res=await fetch("/build.json",{cache:"no-store",credentials:"include",redirect:"error"});
    if(!res.ok||!res.headers.get("content-type")?.includes("json"))throw Error("Build metadata was intercepted.");
    const b=await res.json();
    for(const c of b.cases){
      const manifestResponse=await fetch("/"+c.key+"/manifest.webmanifest",{cache:"no-store",credentials:"include",redirect:"error"});
      if(!manifestResponse.ok||!manifestResponse.headers.get("content-type")?.includes("manifest+json"))throw Error("Manifest was intercepted: "+c.key);
      const manifest=await manifestResponse.json();
      if(manifest.id!=="/vizion-icon-test/"+b.version+"/"+c.key||manifest.icons.length!==1||manifest.icons[0].src!==c.icon)throw Error("Unexpected manifest identity or icon: "+c.key);
      for(const p of new Set([c.icon,c.apple].filter(Boolean))){
        const r=await fetch(p,{cache:"no-store",credentials:"include",redirect:"error"});
        const expected=b.files[p];
        if(!r.ok||!r.headers.get("content-type")?.startsWith(expected.type.split(";")[0]))throw Error("Wrong asset response: "+p);
        const bytes=await r.arrayBuffer();
        const hash=Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",bytes)),x=>x.toString(16).padStart(2,"0")).join("");
        if(hash!==expected.sha256)throw Error("Asset hash mismatch: "+p);
      }
    }
    el.textContent="Isolation and asset preflight passed in this browser. This is not Home Screen acceptance. Record the origin, version and appearance for each installation.";
    el.dataset.result="passed";
  }catch(error){el.textContent="Do not interpret installation results yet: "+error.message;el.dataset.result="blocked";}
}check();`;
  await put("probe.js", browserJs);
  const page = (title, head, body) => `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>${escapeHtml(title)}</title><link rel="stylesheet" href="/probe.css">${head}<script src="/probe.js" defer></script></head><body><h1>${escapeHtml(title)}</h1><p id="isolation">Checking origin isolation and asset responses. Do not install until this check finishes.</p><p>Test version <code>${version}</code>. Base commit <code>${sha}</code>.</p><p>${escapeHtml(build.sourceState)}. <strong>No physical-device result is claimed.</strong></p>${body}<p><a href="/build.json">Build record and SHA-256 asset hashes</a></p></body></html>\n`;
  for (const c of cases) {
    const manifest = {
      name: `${c.title} ${version.slice(0, 6)}`,
      short_name: c.title,
      id: `/vizion-icon-test/${version}/${c.key}`,
      start_url: `/${c.key}/?iconTest=${version}`,
      scope: `/${c.key}/`,
      display: "standalone",
      icons: [{ src: c.icon, sizes: c.sizes, type: c.type, purpose: "any" }],
    };
    await put(`${c.key}/manifest.webmanifest`, JSON.stringify(manifest, null, 2) + "\n");
    const head =
      `<meta name="apple-mobile-web-app-capable" content="yes"><meta name="apple-mobile-web-app-title" content="${c.title}"><link rel="manifest" href="/${c.key}/manifest.webmanifest" crossorigin="use-credentials">` +
      (c.apple ? `<link rel="apple-touch-icon" href="${c.apple}" sizes="180x180">` : "");
    const paths = [...new Set([c.icon, c.apple].filter(Boolean))];
    const body =
      `<p>${escapeHtml(c.explanation)}</p><p>Use Safari's Add to Home Screen from THIS page. These test apps are independent of VIZION.</p>` +
      paths
        .map(
          (p) =>
            `<section><h2>Browser rendering only</h2><img src="${p}" alt="Diagnostic artwork"><p><code>${p}</code></p><p>SHA-256 <code>${build.files[p].sha256}</code></p></section>`,
        )
        .join("") +
      `<p><a href="/">Return to the three test cases</a></p>`;
    await put(`${c.key}/index.html`, page(c.title, head, body));
  }
  await put(
    "index.html",
    page(
      "VIZION icon installation diagnostic",
      "",
      `<p>Use a separate, unused HTTPS origin. This bundle has no production head, root touch icon, app authentication code or service worker. It does not change or remove production data.</p>${cases.map((c) => `<section><h2><a href="/${c.key}/">${c.title}</a></h2><p>${escapeHtml(c.explanation)}</p></section>`).join("")}<section><h2>Authored adaptive SVG preview</h2><img src="${preview}" alt="Unmodified canonical outlined icon"><p>Browser rendering, not an installed iPhone icon. The preview follows this browser's resolved scheme.</p></section><p>For each test: install in Light, observe Light then Dark; remove only the diagnostic installation, install in Dark, observe Dark then Light. Test Auto separately. Record Clear and Tinted separately. Do not remove the production app or clear Safari data.</p>`,
    ),
  );
  await put(
    "vercel.json",
    JSON.stringify(
      {
        version: 2,
        cleanUrls: false,
        headers: [
          {
            source: "/(.*)",
            headers: [
              { key: "Cache-Control", value: "no-store" },
              { key: "X-Content-Type-Options", value: "nosniff" },
              { key: "Content-Security-Policy", value: CSP },
            ],
          },
        ],
      },
      null,
      2,
    ) + "\n",
  );
  // build.json deliberately does not hash itself.
  await fs.writeFile(
    path.join(out, "build.json"),
    JSON.stringify(build, null, 2) + "\n",
    { flag: "wx" },
  );
  return { outDir: out, ...build };
}

/** Local inspection only. Use an authorized, separate HTTPS origin on iPhone. */
export async function serveIconDiagnostic({
  directory,
  host = "127.0.0.1",
  port = 4173,
}) {
  const root = await fs.realpath(directory);
  assert(!within(await fs.realpath(ROOT), root), "Refusing to serve the repository");
  const build = JSON.parse(await fs.readFile(path.join(root, "build.json"), "utf8"));
  assert(
    build.schema === 1 && build.cases?.length === 3,
    "Not an icon diagnostic bundle",
  );
  const allowed = new Set([...Object.keys(build.files), "/build.json"]);
  allowed.delete("/vercel.json");
  const server = createServer(async (req, res) => {
    try {
      if (!["GET", "HEAD"].includes(req.method || "")) {
        res.writeHead(405, { Allow: "GET, HEAD" });
        res.end();
        return;
      }
      const url = new URL(req.url || "/", "http://diagnostic.invalid");
      let pathname = decodeURIComponent(url.pathname);
      if (pathname.endsWith("/")) pathname += "index.html";
      const file = path.resolve(root, `.${pathname}`);
      if (
        !allowed.has(pathname) ||
        !within(root, file) ||
        !(await fs.lstat(file)).isFile() ||
        !within(root, await fs.realpath(file))
      ) {
        res.writeHead(404, { "Content-Type": "text/plain", "Cache-Control": "no-store" });
        res.end("Not found\n");
        return;
      }
      const data = await fs.readFile(file);
      res.writeHead(200, {
        "Content-Type": MIME[path.extname(file)] || "text/plain",
        "Content-Length": data.length,
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": CSP,
      });
      res.end(req.method === "HEAD" ? undefined : data);
    } catch {
      res.writeHead(404, { "Content-Type": "text/plain", "Cache-Control": "no-store" });
      res.end("Not found\n");
    }
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, resolve);
  });
  return server;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
  try {
    const [command, directory, sha] = process.argv.slice(2);
    if (command === "build" && directory) {
      const result = await buildIconDiagnostic({ outDir: directory, baseSha: sha });
      console.log(
        JSON.stringify(
          {
            outDir: result.outDir,
            version: result.version,
            baseCommit: result.baseCommit,
          },
          null,
          2,
        ),
      );
    } else if (command === "serve" && directory) {
      assert(sha === undefined, "serve takes only the bundle directory");
      await serveIconDiagnostic({ directory });
      console.log(
        "Local inspection: http://127.0.0.1:4173/ (not a device-accessible deployment)",
      );
    } else {
      throw new Error(
        "Usage: node scripts/icon-diagnostic.mjs build <new-outside-repo-directory> [base-SHA] | serve <bundle-directory>",
      );
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
