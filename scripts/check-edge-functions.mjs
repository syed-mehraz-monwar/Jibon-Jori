#!/usr/bin/env node
//
// Edge Function gate: typecheck, lint and behaviourally test the Supabase Edge
// Functions with Deno, the runtime they actually run on.
//
// Why this exists: these functions are deployed to Deno, so `tsc` and ESLint are the
// wrong instruments for them. Before this gate they had only ever been read by eye.
// Deno is not installed by default on this machine, so the script resolves it and, if
// it is genuinely absent, provisions a pinned copy into a cache directory outside the
// repository. If that is impossible (no network, no permission), the gate reports SKIP
// and exits 0, exactly like the APK scan does when there is no APK - it never reports a
// pass it did not earn.
//
// The tests themselves live in `supabase/functions/tests` and import only `_shared/*`,
// never a function's `index.ts`, because those call `Deno.serve` at import time.
//
// Usage:
//   node scripts/check-edge-functions.mjs                 # check + lint + test
//   node scripts/check-edge-functions.mjs --mutation      # also prove the tests bite
//
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const FUNCTIONS_DIR = join(ROOT, "supabase", "functions");
const TESTS_DIR = join(FUNCTIONS_DIR, "tests");
const CACHE_DIR = join(tmpdir(), "jibonjori-deno");
const DENO_VERSION = "2.9.6";

function log(message) {
  console.log(`[edge-functions] ${message}`);
}

function run(cmd, args, options = {}) {
  const result = spawnSync(cmd, args, {
    encoding: "utf8",
    shell: false,
    ...options,
  });
  return {
    status: result.status ?? 1,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    error: result.error,
  };
}

function collectTsFiles(dir) {
  const files = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) files.push(...collectTsFiles(full));
    else if (entry.name.endsWith(".ts")) files.push(full);
  }
  return files;
}

function existsDenoBinary(path) {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

/**
 * On Windows, spawning `npm.cmd` directly fails with EINVAL, and shell:true is both
 * warned about and unreliable for paths containing spaces. Invoking npm's JavaScript
 * entry point through the current node executable avoids both problems entirely.
 */
function npmCliJs() {
  const nodeDir = dirname(process.execPath);
  const candidate = join(nodeDir, "node_modules", "npm", "bin", "npm-cli.js");
  return existsSync(candidate) ? candidate : null;
}

function installDeno(prefix) {
  mkdirSync(prefix, { recursive: true });
  const npmCli = npmCliJs();
  if (npmCli) {
    return run(process.execPath, [npmCli, "install", "--prefix", prefix, `deno@${DENO_VERSION}`, "--no-audit", "--no-fund"]);
  }
  const npm = process.platform === "win32" ? "npm.cmd" : "npm";
  return run(npm, ["install", "--prefix", prefix, `deno@${DENO_VERSION}`, "--no-audit", "--no-fund"], { shell: process.platform === "win32" });
}

function resolveDeno() {
  if (process.env.DENO_BIN && existsDenoBinary(process.env.DENO_BIN)) {
    log(`using DENO_BIN: ${process.env.DENO_BIN}`);
    return process.env.DENO_BIN;
  }

  const onPath = run(process.platform === "win32" ? "where" : "which", ["deno"]);
  if (onPath.status === 0) {
    const first = onPath.stdout.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)[0];
    if (first && existsDenoBinary(first)) {
      log(`using deno from PATH: ${first}`);
      return first;
    }
  }

  const cached = join(
    CACHE_DIR,
    "node_modules",
    "deno",
    process.platform === "win32" ? "deno.exe" : "deno",
  );
  if (existsDenoBinary(cached)) {
    log(`using cached deno: ${cached}`);
    return cached;
  }

  log(`deno not found; provisioning ${DENO_VERSION} into ${CACHE_DIR}`);
  const install = installDeno(CACHE_DIR);
  if (install.status !== 0) {
    log(`npm install failed: ${install.stderr.trim() || install.error?.message || "unknown error"}`);
    return null;
  }

  const installer = join(CACHE_DIR, "node_modules", "deno", "install.cjs");
  if (existsSync(installer)) {
    // npm may block the package's own postinstall, which is what fetches the binary.
    const post = run(process.execPath, [installer]);
    if (post.status !== 0) {
      log(`deno binary installer failed: ${post.stderr.trim() || post.error?.message || "unknown error"}`);
      return null;
    }
  }

  if (existsDenoBinary(cached)) {
    log(`provisioned deno: ${cached}`);
    return cached;
  }
  log("deno binary still absent after provisioning");
  return null;
}

function main() {
  const deno = resolveDeno();
  if (!deno) {
    log("SKIP: Deno could not be resolved, so the Edge Functions were not checked.");
    log("      Install Deno (https://deno.land) or set DENO_BIN, then re-run.");
    process.exit(0);
  }

  const version = run(deno, ["--version"]);
  const versionLine = version.stdout.split(/\r?\n/)[0]?.trim() ?? "unknown";
  log(versionLine);

  const files = collectTsFiles(FUNCTIONS_DIR);
  log(`checking ${files.length} TypeScript file(s)`);

  const check = run(deno, ["check", "--no-lock", ...files]);
  const checkOut = `${check.stdout}${check.stderr}`.trim();
  if (check.status === 0) {
    log("typecheck: PASS");
  } else {
    log("typecheck: FAIL");
    console.log(checkOut);
  }

  const lint = run(deno, ["lint", "--no-config", ...files]);
  const lintOut = `${lint.stdout}${lint.stderr}`.trim();
  if (lint.status === 0) {
    log("lint: PASS");
  } else {
    log("lint: FAIL");
    console.log(lintOut);
  }

  const test = run(deno, ["test", "--no-lock", "--allow-env", "--allow-net", TESTS_DIR]);
  const testOut = `${test.stdout}${test.stderr}`;
  const summaryLine = testOut.split(/\r?\n/).find((l) => /\|\s*\d+ passed/.test(l)) ?? "";
  const clean = summaryLine.replace(/\u001b\[[0-9;]*m/g, "").trim();
  if (test.status === 0) {
    log(`tests: PASS ${clean}`);
  } else {
    log("tests: FAIL");
    console.log(testOut.replace(/\u001b\[[0-9;]*m/g, ""));
  }

  let mutationOk = true;
  if (process.argv.includes("--mutation")) {
    log("mutation: proving the tests detect a reintroduced defect");
    const scratch = join(tmpdir(), "jibonjori-deno-mutation");
    rmSync(scratch, { recursive: true, force: true });
    mkdirSync(join(scratch, "tests"), { recursive: true });
    const copy = (from, to) => {
      mkdirSync(to, { recursive: true });
      for (const entry of readdirSync(from, { withFileTypes: true })) {
        const source = join(from, entry.name);
        const target = join(to, entry.name);
        if (entry.isDirectory()) {
          copy(source, target);
        } else {
          writeFileSync(target, readFileSync(source));
        }
      }
    };
    copy(join(FUNCTIONS_DIR, "_shared"), join(scratch, "_shared"));
    copy(TESTS_DIR, join(scratch, "tests"));

    const jwtPath = join(scratch, "_shared", "jwt.ts");
    const original = readFileSync(jwtPath, "utf8");
    const alphabet = 'const standard = payload.replace(/-/g, "+").replace(/_/g, "/");';
    if (!original.includes(alphabet)) {
      log("mutation: FAIL - could not locate the alphabet conversion to remove");
      mutationOk = false;
    } else {
      writeFileSync(jwtPath, original.replace(alphabet, "const standard = payload;"));
      const mutated = run(deno, ["test", "--no-lock", "--allow-env", "--allow-net", join(scratch, "tests")]);
      const detected = mutated.status !== 0;
      log(`mutation: ${detected ? "PASS (defect detected)" : "FAIL (defect NOT detected)"}`);
      mutationOk = detected;
    }
    rmSync(scratch, { recursive: true, force: true });
  }

  const failed = check.status !== 0 || lint.status !== 0 || test.status !== 0 || !mutationOk;
  if (failed) {
    log("EDGE FUNCTION GATE FAILED");
    process.exit(1);
  }
  log("EDGE FUNCTION GATE PASSED");
}

main();
