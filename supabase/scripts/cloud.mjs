#!/usr/bin/env node
/**
 * =============================================================================
 * JibonJori - Supabase Cloud orchestration
 * =============================================================================
 * A thin, guarded wrapper around the Supabase CLI for this project's cloud
 * activation. It exists for three reasons:
 *
 *   1. Guards. Nothing that mutates a cloud project runs without an explicit
 *      --project-ref AND --confirm. `--dry-run` prints the exact command and runs
 *      nothing. There is no path here that resets or drops a remote database:
 *      `db reset` is deliberately NOT exposed.
 *
 *   2. Determinism. The CLI is resolved from a known list (local devDependency
 *      first, then a pinned `npx supabase@<version>`), rather than whatever
 *      `supabase` happens to be first on PATH.
 *
 *   3. Discoverability. The Edge Functions are enumerated from the directory, so
 *      deploying them does not depend on someone remembering all five names.
 *
 * Usage:
 *   node supabase/scripts/cloud.mjs help
 *   node supabase/scripts/cloud.mjs doctor
 *   node supabase/scripts/cloud.mjs link     --project-ref <ref>
 *   node supabase/scripts/cloud.mjs status   --project-ref <ref>
 *   node supabase/scripts/cloud.mjs push     --project-ref <ref> [--dry-run] [--confirm]
 *   node supabase/scripts/cloud.mjs functions --project-ref <ref> [--only NAME] [--dry-run] [--confirm]
 *   node supabase/scripts/cloud.mjs secrets  [--env-file PATH] [--dry-run] [--confirm]
 *   node supabase/scripts/cloud.mjs verify   [--project-ref <ref>]
 *
 * `verify` runs the READ-ONLY `scripts/verify-cloud.sql` and needs `psql` plus
 * `SUPABASE_DB_URL`. If `psql` is not on PATH it prints how to run the same file
 * from the dashboard SQL Editor instead.
 *
 * No credential is read from, or written to, this repository. The service-role
 * key is never an argument to this script: the CLI carries its own login.
 * =============================================================================
 */
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const supabaseDir = join(here, "..");
const repoRoot = join(supabaseDir, "..");
const isWindows = process.platform === "win32";

/** Version pinned so a run is reproducible; bump deliberately. */
const PINNED_CLI = "supabase@2.118.0";

function log(message) {
  process.stdout.write(`${message}\n`);
}

function fail(message) {
  process.stderr.write(`\n[cloud] ERROR: ${message}\n`);
  process.exit(1);
}

// ---------------------------------------------------------------------------- args
function parseArgs(argv) {
  const parsed = {
    command: undefined,
    projectRef: undefined,
    envFile: join(supabaseDir, ".env"),
    only: [],
    passthrough: [],
    dryRun: false,
    confirm: false,
  };
  const known = new Set([
    "help",
    "doctor",
    "link",
    "status",
    "push",
    "functions",
    "secrets",
    "verify",
    "runtime",
  ]);

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--") {
      parsed.passthrough = argv.slice(i + 1);
      break;
    }
    if (!parsed.command && !arg.startsWith("-")) {
      if (!known.has(arg)) fail(`unknown command "${arg}". Try: help`);
      parsed.command = arg;
    } else if (arg === "--project-ref") parsed.projectRef = argv[++i];
    else if (arg === "--env-file") parsed.envFile = argv[++i];
    else if (arg === "--only") parsed.only.push(argv[++i]);
    else if (arg === "--dry-run") parsed.dryRun = true;
    else if (arg === "--confirm") parsed.confirm = true;
    else fail(`unknown argument "${arg}". Try: help`);
  }
  return parsed;
}

const args = parseArgs(process.argv.slice(2));

if (!args.command || args.command === "help") {
  log(
    [
      "JibonJori - Supabase Cloud orchestration",
      "",
      "  node supabase/scripts/cloud.mjs doctor",
      "  node supabase/scripts/cloud.mjs link      --project-ref <ref>",
      "  node supabase/scripts/cloud.mjs status    --project-ref <ref>",
      "  node supabase/scripts/cloud.mjs push      --project-ref <ref> [--dry-run] [--confirm]",
      "  node supabase/scripts/cloud.mjs functions --project-ref <ref> [--only NAME] [--dry-run] [--confirm]",
      "  node supabase/scripts/cloud.mjs secrets   [--env-file PATH] [--dry-run] [--confirm]",
      "  node supabase/scripts/cloud.mjs verify    [--project-ref <ref>]",
      "  node supabase/scripts/cloud.mjs runtime   [-- --only auth|rls|storage|functions|realtime]",
      "",
      "Mutating commands require --project-ref and --confirm. --dry-run prints the",
      "exact command and runs nothing. There is no remote reset/drop command here.",
      "",
      "`runtime` is the adversarial harness (supabase/scripts/verify-cloud-runtime.mjs):",
      "it needs SUPABASE_URL / SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY and writes",
      "throwaway test data, so point it at a throwaway project or a preview branch.",
      "See docs/SUPABASE_CLOUD_SETUP.md.",
      "",
    ].join("\n")
  );
  process.exit(0);
}

// ------------------------------------------------------------------- safety rails
/** A project ref is a short lowercase alphanumeric id; placeholders are refused. */
function requireProjectRef() {
  const ref = String(args.projectRef ?? "").trim();
  if (ref.length === 0) {
    fail(
      "this command needs --project-ref <ref>.\n" +
        "  Find it at: Supabase Dashboard -> Settings -> General -> Reference ID\n" +
        "  (or read it from the Project URL: https://<ref>.supabase.co)"
    );
  }
  if (!/^[a-z0-9]{15,30}$/.test(ref)) {
    fail(
      `"${ref}" does not look like a Supabase project reference.\n` +
        "  Expected 15-30 lowercase letters and digits, e.g. abcdefghijklmnop."
    );
  }
  if (/^(your|my|project|abcdefgh)/i.test(ref)) {
    fail(`"${ref}" looks like a placeholder, not a real project reference.`);
  }
  return ref;
}

/** Every mutating command goes through this. */
function requireConfirmation(action) {
  if (args.dryRun) return;
  if (!args.confirm) {
    fail(
      `refusing to ${action} without --confirm.\n` +
        "  Re-run with --confirm once you are sure of the target project, or use\n" +
        "  --dry-run to see exactly what would be executed."
    );
  }
}

// ------------------------------------------------------------------------ the CLI
/**
 * Resolves how to invoke the Supabase CLI.
 *
 * The CLI is run as a child of the SAME `node` that is running this script, via npm's
 * `npx-cli.js`. That avoids `cmd.exe` entirely, which matters for two verified reasons:
 *
 *   * On Windows an npm shim is a `.cmd`, and modern Node refuses to spawn one without a
 *     shell. Wrapping it in `cmd.exe /c "..."` then breaks any path containing a space
 *     (both the nested-quoting forms fail), so the repo could not be built from a path
 *     like "D:\My Projects\...".
 *   * `shell: true` would work but concatenates arguments instead of escaping them, which
 *     is both a Node deprecation warning and an injection risk for the user-supplied
 *     project ref.
 *
 * `npx` also resolves a locally installed `supabase` devDependency before downloading, so
 * one path covers both cases. The version is pinned so a run is reproducible.
 */
function resolveCli() {
  const nodeDir = dirname(process.execPath);
  const candidates = [
    // Standard npm layout on Windows and in the official Node distributions.
    join(nodeDir, "node_modules", "npm", "bin", "npx-cli.js"),
    // Some POSIX layouts put npm one level up.
    join(nodeDir, "..", "lib", "node_modules", "npm", "bin", "npx-cli.js"),
  ];
  const npxCli = candidates.find((candidate) => existsSync(candidate));

  if (npxCli) {
    return {
      label: `npx --yes ${PINNED_CLI}`,
      command: process.execPath,
      prefix: [npxCli, "--yes", PINNED_CLI],
    };
  }

  // Last resort: a `supabase` already on PATH. Only safe when the resolved path has no
  // space, because the cmd.exe wrapper cannot survive one.
  const onPath = spawnSync(isWindows ? "where.exe" : "which", ["supabase"], {
    encoding: "utf8",
    shell: false,
  });
  const found = onPath.status === 0 ? (onPath.stdout ?? "").trim().split(/\r?\n/)[0] : "";
  if (found && !found.includes(" ")) {
    return { label: found, command: found, prefix: [] };
  }

  fail(
    "could not locate npm's npx-cli.js next to the running node.\n" +
      `  Node is at: ${process.execPath}\n` +
      "  Install the Supabase CLI once and re-run:\n" +
      `    npm install --save-dev ${PINNED_CLI}\n` +
      "  Or make it available on PATH (the path must not contain a space)."
  );
}

/** Runs a command with no shell, streaming output. */
function run(label, command, commandArgs, options = {}) {
  const printable = [command, ...commandArgs].join(" ");
  log(`\n$ ${printable}`);
  if (options.dryRun) {
    log("  (dry run - not executed)");
    return 0;
  }
  const result = spawnSync(command, commandArgs, {
    stdio: "inherit",
    cwd: options.cwd ?? repoRoot,
    shell: false,
  });
  if (result.error) {
    fail(`could not run "${label}": ${result.error.message}`);
  }
  return result.status ?? 1;
}

function cli(cliArgs, options = {}) {
  const resolved = resolveCli();
  return run(resolved.label, resolved.command, [...resolved.prefix, ...cliArgs], options);
}

/** Captures CLI output as text (for version probing). */
function cliCapture(cliArgs) {
  const resolved = resolveCli();
  const result = spawnSync(resolved.command, [...resolved.prefix, ...cliArgs], {
    encoding: "utf8",
    cwd: repoRoot,
    shell: false,
  });
  return {
    status: result.status ?? 1,
    stdout: (result.stdout ?? "").trim(),
    stderr: (result.stderr ?? "").trim(),
    error: result.error,
  };
}

// ------------------------------------------------------------------------ commands
function commandDoctor() {
  log("=== cloud doctor ===");
  log(`node          : ${process.version}`);
  log(`platform      : ${process.platform}`);

  const resolved = resolveCli();
  log(`supabase cli  : ${resolved.label}`);

  const version = cliCapture(["--version"]);
  if (version.status !== 0) {
    log("  status      : NOT AVAILABLE");
    log(`  stderr      : ${version.stderr.split("\n").slice(-3).join(" | ")}`);
    log("");
    log("  The CLI is not installed locally and could not be fetched by npx.");
    log("  Install it once, either as a devDependency or globally:");
    log(`    npm install --save-dev ${PINNED_CLI.split("@")[0]}@${PINNED_CLI.split("@")[1]}`);
    log("  Then re-run: node supabase/scripts/cloud.mjs doctor");
    return 0;
  }
  log(`  version     : ${version.stdout.split("\n")[0]}`);

  const projects = cliCapture(["projects", "list"]);
  if (projects.status !== 0) {
    log("  login       : NOT LOGGED IN (or no network)");
    log("                Run: npx supabase login");
  } else {
    log("  login       : ok (`supabase projects list` succeeded)");
    if (projects.stdout.length > 0) {
      log("");
      log(projects.stdout);
    }
  }

  log("");
  log("No mutation was performed. Next: link a project.");
  log("  node supabase/scripts/cloud.mjs link --project-ref <ref>");
  return 0;
}

function commandLink() {
  const ref = requireProjectRef();
  log("=== link ===");
  log(`target ref    : ${ref}`);
  log("The CLI will prompt for the database password if it needs it.");
  // Linking writes local project state, not cloud state, so --confirm is not required;
  // it is still refused under --dry-run.
  return cli(["link", "--project-ref", ref], { dryRun: args.dryRun });
}

function commandStatus() {
  const ref = requireProjectRef();
  log("=== migration status (read-only) ===");
  log(`target ref    : ${ref}`);
  let status = cli(["migration", "list", "--project-ref", ref], { dryRun: args.dryRun });
  if (status !== 0) {
    log("\n`migration list --project-ref` failed; falling back to the linked project.");
    status = cli(["migration", "list"], { dryRun: args.dryRun });
  }
  return status;
}

function commandPush() {
  const ref = requireProjectRef();
  requireConfirmation(`apply migrations to project ${ref}`);
  log("=== db push (apply migrations) ===");
  log(`target ref    : ${ref}`);
  log("This applies every file in supabase/migrations, then the idempotent reference");
  log("seed (0008). It does not reset or drop anything.");
  const dry = args.dryRun ? ["--dry-run"] : [];
  return cli(["db", "push", "--project-ref", ref, ...dry], { dryRun: args.dryRun });
}

/** Enumerates deployable functions: one directory each, excluding `_shared`. */
function discoverFunctions() {
  const root = join(supabaseDir, "functions");
  if (!existsSync(root)) return [];
  return readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .filter((name) => !name.startsWith("_") && !name.startsWith("."))
    .filter((name) => existsSync(join(root, name, "index.ts")))
    .sort();
}

function commandFunctions() {
  const ref = requireProjectRef();
  const all = discoverFunctions();
  if (all.length === 0) fail("no Edge Functions found under supabase/functions.");

  const targets = args.only.length > 0 ? args.only : all;
  for (const name of targets) {
    if (!all.includes(name)) {
      fail(`"${name}" is not a deployable function. Available: ${all.join(", ")}`);
    }
  }

  requireConfirmation(`deploy ${targets.length} Edge Function(s) to project ${ref}`);
  log("=== functions deploy ===");
  log(`target ref    : ${ref}`);
  log(`functions     : ${targets.join(", ")}`);

  let status = 0;
  for (const name of targets) {
    const code = cli(
      ["functions", "deploy", name, "--project-ref", ref],
      { dryRun: args.dryRun }
    );
    if (code !== 0) {
      status = code;
      log(`  ! ${name} failed (exit ${code})`);
    }
  }
  if (status === 0 && !args.dryRun) {
    log("\nAll requested functions deployed.");
    log("Remember the secrets in the next step, or ai-chat/ai-explanation will fall back.");
  }
  return status;
}

/**
 * Sets Edge Function secrets from an env file.
 *
 * Blank values are dropped rather than set: a secret set to the empty string is not
 * `unset`, and `LLM_API_KEY=` would silently look configured to anything that checks
 * for presence of the variable. The filtered copy goes to the OS temp directory and is
 * removed immediately afterwards, so a secrets file is never left in the repository.
 */
function commandSecrets() {
  requireConfirmation("set Edge Function secrets");

  if (!existsSync(args.envFile)) {
    fail(
      `no env file at ${args.envFile}.\n` +
        "  Copy supabase/functions/.env.example to supabase/.env (git-ignored),\n" +
        "  fill it in, and re-run. Never commit the filled-in file."
    );
  }

  const raw = readFileSync(args.envFile, "utf8");
  const pairs = [];
  const skipped = [];
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed.length === 0 || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim();
    if (value.length === 0) {
      skipped.push(key);
      continue;
    }
    pairs.push(`${key}=${value}`);
  }

  log("=== secrets set ===");
  log(`env file      : ${args.envFile}`);
  log(`secrets to set: ${pairs.length} (${pairs.map((p) => p.slice(0, p.indexOf("="))).join(", ") || "none"})`);
  if (skipped.length > 0) {
    log(`blank, skipped: ${skipped.join(", ")}`);
  }
  if (pairs.length === 0) {
    log("\nNothing to set. Fill in at least one value in the env file.");
    return 0;
  }
  if (args.dryRun) {
    log("\n(dry run) would run: supabase secrets set --env-file <tempfile>");
    return 0;
  }

  const tempFile = join(
    process.env.TEMP ?? process.env.TMPDIR ?? supabaseDir,
    `jibonjori-secrets-${Date.now()}.env`
  );
  try {
    writeFileSync(tempFile, `${pairs.join("\n")}\n`, { mode: 0o600 });
    return cli(["secrets", "set", "--env-file", tempFile]);
  } finally {
    rmSync(tempFile, { force: true });
  }
}

function commandVerify() {
  if (args.projectRef) requireProjectRef();
  log("=== cloud verification (read-only) ===");

  const sqlFile = join(here, "verify-cloud.sql");
  if (!existsSync(sqlFile)) fail(`missing ${sqlFile}`);

  const hasPsql = spawnSync("psql", ["--version"], { encoding: "utf8", shell: false });
  if (hasPsql.error || hasPsql.status !== 0) {
    log("psql is not available on PATH, so the file cannot be executed from here.");
    log("Run the same checks one of these two ways instead:");
    log("");
    log("  1. Dashboard SQL Editor (no local tooling needed):");
    log("       Supabase Dashboard -> SQL Editor -> New query");
    log(`       Paste the contents of ${sqlFile}`);
    log("");
    log("  2. From WSL, where PostgreSQL's client tools are installed:");
    log("       SUPABASE_DB_URL='<session-pooler-uri-with-password>' \\");
    log(`         psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f ${sqlFile}`);
    log("");
    log("  The connection string is at Settings -> Database -> Connection string.");
    log("  It contains the database password: shell environment only, never a file");
    log("  that is committed.");
    return 0;
  }
  log(`psql          : ${hasPsql.stdout.split("\n")[0]}`);

  const dbUrl = process.env.SUPABASE_DB_URL ?? "";
  if (dbUrl.length === 0) {
    fail(
      "SUPABASE_DB_URL is not set.\n" +
        "  Copy the Session pooler URI from Settings -> Database -> Connection string and\n" +
        "  export it for this command only, e.g.\n" +
        "    $env:SUPABASE_DB_URL='postgresql://postgres.<ref>:<password>@<host>:5432/postgres'\n" +
        "  It contains the database password, so never write it to a committed file."
    );
  }
  const safeTarget = dbUrl.replace(/:\/\/([^:]+):[^@]*@/, "://$1:***@");
  log(`target        : ${safeTarget}`);
  return run("psql", "psql", [dbUrl, "-v", "ON_ERROR_STOP=1", "-f", sqlFile], {
    dryRun: args.dryRun,
  });
}

/**
 * Runs the cloud runtime + adversarial harness.
 *
 * That harness is where access control is actually proved against a real project; it is
 * a separate file because it needs supabase-js and a real JWT, but it is exposed here so
 * the whole activation is one vocabulary rather than two.
 */
function commandRuntime() {
  const harness = join(here, "verify-cloud-runtime.mjs");
  if (!existsSync(harness)) fail(`missing ${harness}`);
  log("=== cloud runtime + adversarial verification ===");
  log("Requires SUPABASE_URL, SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY in the");
  log("environment, and WRITES throwaway test data: use a throwaway project or a");
  log("preview branch. Pass any extra flags through after --.");
  log("");
  return run("runtime harness", process.execPath, [harness, ...args.passthrough], {
    dryRun: args.dryRun,
  });
}

const COMMANDS = {
  doctor: commandDoctor,
  link: commandLink,
  status: commandStatus,
  push: commandPush,
  functions: commandFunctions,
  secrets: commandSecrets,
  verify: commandVerify,
  runtime: commandRuntime,
};

const handler = COMMANDS[args.command];
if (!handler) fail(`unhandled command "${args.command}"`);
const exitCode = handler() ?? 0;
process.exit(typeof exitCode === "number" ? exitCode : 0);
