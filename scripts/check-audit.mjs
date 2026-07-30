/**
 * Full-tree `npm audit` gate with self-validating exemptions.
 *
 * WHY THIS EXISTS
 * ---------------
 * The full-tree audit step used to be `npm audit || true` — it printed 14 high
 * entries and passed regardless, so a genuinely new advisory would have scrolled
 * past unnoticed among the known ones. That is not a gate, it is noise.
 *
 * Those 14 entries all trace to ONE advisory (GHSA-mh99-v99m-4gvg on
 * `brace-expansion`, range `<=5.0.7`); the rest are "depends on a vulnerable
 * version of…" paths fanning out from it. And it is a FALSE POSITIVE here: the
 * fix was backported to the 1.x and 2.x lines (1.1.17, 2.1.3) but the advisory
 * range was never narrowed, so patched releases are still inside it.
 *
 * It also cannot be removed. `eslint@9` depends on `minimatch@^3.1.5`, and
 * minimatch@3 does `require('brace-expansion')` and CALLS the result — while
 * 5.0.8 exports an object. Forcing ^5 everywhere therefore breaks every braced
 * glob in the tree (it did, silently, for days). So the only patched option for
 * that consumer is a 1.x that the advisory still matches.
 *
 * Rather than ignore the advisory, this script EXEMPTS it and then proves the
 * exemption: every installed copy of the package must actually contain the fix.
 * If a future install pulls a genuinely unpatched copy, the proof fails and so
 * does the build — which a plain ignore-list could never catch.
 */

import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * Advisories that are known false positives here, each with the evidence that
 * makes it one. `verify` must return null when the exemption still holds, or a
 * string explaining why it no longer does.
 *
 * Adding an entry is a deliberate act: it needs a reason a reviewer can check
 * and a `verify` that would fail if the reason stopped being true.
 */
const EXEMPT = [
  {
    id: "GHSA-mh99-v99m-4gvg",
    package: "brace-expansion",
    why:
      "Fix (CVE-2026-14257 expansion limits) was backported to 1.1.17 and 2.1.3, " +
      "but the advisory range `<=5.0.7` was never narrowed. eslint@9 requires " +
      "minimatch@3, which calls brace-expansion as a FUNCTION, so a 1.x is the " +
      "only patched shape available to it — see AGENTS.md.",
    verify: verifyBraceExpansionPatched,
  },
];

/**
 * Every installed copy of `name`, at any nesting depth.
 *
 * The shape matters: from a node_modules directory the children are packages
 * (or `@scope` directories whose children are packages), and ANY package may
 * carry its own nested `node_modules`. An earlier version of this walked only
 * into directories literally named `node_modules`, `@…`, or the target itself —
 * so it never descended through `minimatch/` and silently verified only the
 * root copy. The negative test caught it; that is what negative tests are for.
 */
function findPackageCopies(name, nmDir = "node_modules", found = []) {
  let entries;
  try {
    entries = readdirSync(nmDir, { withFileTypes: true });
  } catch {
    return found;
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const dir = join(nmDir, entry.name);
    if (entry.name.startsWith("@")) {
      // A scope directory behaves like a node_modules directory: its children
      // are packages.
      findPackageCopies(name, dir, found);
      continue;
    }
    if (entry.name === name) found.push(dir);
    findPackageCopies(name, join(dir, "node_modules"), found);
  }
  return found;
}

/**
 * The exemption holds only while EVERY installed copy carries the expansion
 * limits. Checked in the source rather than by version string, because the whole
 * problem here is that version ranges are lying.
 */
function verifyBraceExpansionPatched() {
  const copies = findPackageCopies("brace-expansion");
  if (copies.length === 0) return "no brace-expansion found — cannot verify";

  const unpatched = [];
  for (const dir of copies) {
    const version = JSON.parse(readFileSync(join(dir, "package.json"), "utf8")).version;
    const sources = [
      "index.js",
      "dist/commonjs/index.js",
      "dist/esm/index.js",
    ].flatMap((rel) => {
      try {
        return [readFileSync(join(dir, rel), "utf8")];
      } catch {
        return [];
      }
    });
    if (sources.length === 0) {
      unpatched.push(`${version} at ${dir} (no readable entry point)`);
      continue;
    }
    // Both limits must be present: EXPANSION_MAX alone predates the
    // length-based OOM fix this advisory is actually about.
    const patched = sources.some(
      (src) => src.includes("EXPANSION_MAX") && src.includes("EXPANSION_MAX_LENGTH"),
    );
    if (!patched) unpatched.push(`${version} at ${dir}`);
  }

  return unpatched.length === 0
    ? null
    : `these copies do NOT contain the expansion limits: ${unpatched.join(", ")}`;
}

function audit() {
  try {
    // Non-zero exit is the normal case when advisories exist; the JSON on stdout
    // is what matters.
    return JSON.parse(execFileSync("npm", ["audit", "--json"], { encoding: "utf8" }));
  } catch (err) {
    if (err.stdout) return JSON.parse(err.stdout);
    throw err;
  }
}

const report = audit();
const advisories = new Map();
for (const vuln of Object.values(report.vulnerabilities ?? {})) {
  for (const via of vuln.via ?? []) {
    // String entries are "depends on a vulnerable version of X" paths, not
    // advisories in their own right.
    if (typeof via === "object" && via.url) {
      advisories.set(via.url.replace(/.*\//, ""), via);
    }
  }
}

const exemptById = new Map(EXEMPT.map((e) => [e.id, e]));
const unexpected = [...advisories.entries()].filter(([id]) => !exemptById.has(id));
const failures = [];

for (const [id, exemption] of exemptById) {
  if (!advisories.has(id)) {
    // Not an error: the advisory was withdrawn, re-ranged, or the dependency is
    // gone. Say so, so the exemption gets removed rather than lingering.
    console.log(`· ${id} (${exemption.package}) is no longer reported — drop this exemption.`);
    continue;
  }
  const problem = exemption.verify();
  if (problem) failures.push(`${id} (${exemption.package}): exemption NO LONGER HOLDS — ${problem}`);
  else console.log(`· ${id} (${exemption.package}) exempt, verified patched in place.`);
}

for (const [id, via] of unexpected) {
  failures.push(
    `${id}: ${via.title ?? "advisory"} in ${via.name} (${via.severity}, range ${via.range}) — not exempt.`,
  );
}

const { high = 0, critical = 0 } = report.metadata?.vulnerabilities ?? {};
console.log(
  `npm audit: ${high} high, ${critical} critical across ${advisories.size} distinct advisor${advisories.size === 1 ? "y" : "ies"}.`,
);

if (failures.length > 0) {
  console.error("\nFull-tree audit gate FAILED:");
  for (const f of failures) console.error(`  ✗ ${f}`);
  console.error(
    "\nEither upgrade past it, or add a verified exemption to scripts/check-audit.mjs.",
  );
  process.exit(1);
}

console.log("Full-tree audit gate passed: every advisory is a verified exemption.");
