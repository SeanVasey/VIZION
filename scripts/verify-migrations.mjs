#!/usr/bin/env node
/**
 * Replay every migration in `supabase/migrations/` against a throwaway
 * PostgreSQL cluster, from empty, in filename order.
 *
 * WHY THIS EXISTS. The P2–P5 baseline lived only in the hosted migration
 * ledger for six weeks: the database could not be rebuilt from the repository,
 * and nothing said so — every later migration applied fine on top of a schema
 * that was already there. A migration that cannot run from scratch is
 * invisible until the day you need it.
 *
 * `supabase db reset` is the first-choice tool and needs Docker. This is the
 * fallback for environments without a daemon: it drives the same SQL through a
 * plain server plus `scripts/pg-shim.sql`, which supplies only the handful of
 * platform objects the migrations reference.
 *
 * WHAT A PASS MEANS: the SQL applies cleanly from empty, in order, and the
 * resulting `public` schema fingerprints as printed. It does NOT mean the
 * schema matches production — for that, run `scripts/pg-introspect.sql`
 * against the hosted project and compare the two tables row for row. See
 * docs/runbooks/migrations.md.
 *
 * Exits 0 on success, 1 on a failed migration, 2 when no server binaries are
 * available (a skip, not a failure — this is not in the commit gate).
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, rmSync, chmodSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const ROOT = join(fileURLToPath(import.meta.url), "..", "..");
const MIGRATIONS = join(ROOT, "supabase", "migrations");

/** Where initdb/pg_ctl/psql live. Distro packages keep them off PATH. */
function findBinDir() {
  for (const dir of [
    process.env.PG_BINDIR,
    ...["18", "17", "16", "15", "14"].map((v) => `/usr/lib/postgresql/${v}/bin`),
    "/usr/local/pgsql/bin",
    "/opt/homebrew/opt/postgresql@16/bin",
  ]) {
    if (dir && existsSync(join(dir, "initdb"))) return dir;
  }
  try {
    // Already on PATH?
    execFileSync("initdb", ["--version"], { stdio: "ignore" });
    return "";
  } catch {
    return null;
  }
}

const BIN = findBinDir();
if (BIN === null) {
  console.error(
    "verify-migrations: no PostgreSQL server binaries found.\n" +
      "  Install a postgresql server package, set PG_BINDIR, or use `supabase db reset`.\n" +
      "  Skipping — this check is not part of the commit gate.",
  );
  process.exit(2);
}

/**
 * initdb refuses to run as root. When we are root (containers, CI images),
 * hand the whole thing to an unprivileged account and make the data directory
 * reachable by it.
 */
const RUN_AS =
  typeof process.getuid === "function" && process.getuid() === 0
    ? ["postgres", "nobody"].find((u) => {
        try {
          execFileSync("id", ["-u", u], { stdio: "ignore" });
          return true;
        } catch {
          return false;
        }
      })
    : null;

if (typeof process.getuid === "function" && process.getuid() === 0 && !RUN_AS) {
  console.error(
    "verify-migrations: running as root and no unprivileged user to drop to.",
  );
  process.exit(2);
}

const dir = mkdtempSync(join(tmpdir(), "vizion-pgverify-"));
// The unprivileged user has to traverse and write here.
chmodSync(dir, 0o777);

/** Run a command as RUN_AS when we are root, directly otherwise. */
function run(cmd, args, opts = {}) {
  const exe = BIN ? join(BIN, cmd) : cmd;
  if (!RUN_AS) return execFileSync(exe, args, { encoding: "utf8", ...opts });
  const quoted = [exe, ...args]
    .map((a) => `'${String(a).replace(/'/g, "'\\''")}'`)
    .join(" ");
  return execFileSync("su", [RUN_AS, "-s", "/bin/bash", "-c", quoted], {
    encoding: "utf8",
    ...opts,
  });
}

const psql = (args) =>
  run("psql", [
    "-h",
    dir,
    "-U",
    "postgres",
    "-d",
    "postgres",
    "-v",
    "ON_ERROR_STOP=1",
    ...args,
  ]);

let started = false;
try {
  if (RUN_AS) execFileSync("chown", ["-R", RUN_AS, dir]);
  run(
    "initdb",
    [
      "-D",
      join(dir, "data"),
      "-U",
      "postgres",
      "--auth=trust",
      "--no-sync",
      "-E",
      "UTF8",
    ],
    {
      stdio: "ignore",
    },
  );
  run(
    "pg_ctl",
    [
      "-D",
      join(dir, "data"),
      // Unix socket only: no TCP port to collide with a real local server.
      "-o",
      `-k ${dir} -h '' -c listen_addresses=''`,
      "-l",
      join(dir, "pg.log"),
      "-w",
      "start",
    ],
    { stdio: "ignore" },
  );
  started = true;

  psql(["-q", "-f", join(ROOT, "scripts", "pg-shim.sql")]);

  const files = readdirSync(MIGRATIONS)
    .filter((f) => f.endsWith(".sql"))
    .sort();
  if (files.length === 0) throw new Error("no migrations found");

  for (const f of files) {
    try {
      psql(["-q", "-f", join(MIGRATIONS, f)]);
      console.log(`  ok    ${f}`);
    } catch (err) {
      console.log(`  FAIL  ${f}`);
      console.error(String(err.stderr || err.message).replace(/^/gm, "        "));
      process.exitCode = 1;
      break;
    }
  }

  if (process.exitCode !== 1) {
    console.log(`\n${files.length} migrations replayed from empty.\n`);
    console.log(
      psql(["-A", "-F", "  ", "-f", join(ROOT, "scripts", "pg-introspect.sql")]),
    );
    console.log(
      "Compare against production: run scripts/pg-introspect.sql on the hosted\n" +
        "project and diff the two tables. See docs/runbooks/migrations.md.",
    );
  }
} catch (err) {
  console.error(`verify-migrations: ${err.message}`);
  process.exitCode = 1;
} finally {
  if (started) {
    try {
      run("pg_ctl", ["-D", join(dir, "data"), "-m", "immediate", "-w", "stop"], {
        stdio: "ignore",
      });
    } catch {
      /* already down */
    }
  }
  rmSync(dir, { recursive: true, force: true });
}
