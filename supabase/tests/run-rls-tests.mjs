#!/usr/bin/env node
// =============================================================================
// JibonJori - local RLS test harness
// =============================================================================
// Runs the real migrations against a real PostgreSQL and asserts the security
// model in supabase/tests/rls_assertions.sql. Supabase is PostgreSQL, so RLS and
// the auth.uid() checks can be verified before the project is even created.
//
//   node supabase/tests/run-rls-tests.mjs
//
// Requirements: Docker (the daemon must be running). Nothing is installed on the
// host: PostgreSQL lives in a throwaway container and the harness only ever
// talks to it through `docker exec ... psql`.
//
// This is a DEVELOPMENT tool. The shipped application never connects to a local
// database - it talks only to Supabase over HTTPS.
//
// Environment overrides:
//   JJ_TEST_PG_CONTAINER  container name              (default jibonjori-rls)
//   JJ_TEST_PG_IMAGE      image to run                (default postgres:16-alpine)
//   JJ_TEST_PG_PORT       host port to publish        (default 55432)
//   JJ_TEST_DB            throwaway database name     (default jibonjori_rls_test)
//   JJ_TEST_KEEP          "1" to leave the container running (default: removed)
// =============================================================================

import { spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SUPABASE_DIR = path.resolve(HERE, "..");
const MIGRATIONS_DIR = path.join(SUPABASE_DIR, "migrations");

const CONTAINER = process.env.JJ_TEST_PG_CONTAINER ?? "jibonjori-rls";
const IMAGE = process.env.JJ_TEST_PG_IMAGE ?? "postgres:16-alpine";
const PORT = process.env.JJ_TEST_PG_PORT ?? "55432";
const DB = process.env.JJ_TEST_DB ?? "jibonjori_rls_test";
const KEEP = process.env.JJ_TEST_KEEP === "1";

// Disposable credentials for an ephemeral container holding no real data. They
// are never used by, shipped with, or reachable from the application.
const PG_PASSWORD = process.env.JJ_TEST_PG_PASSWORD ?? "jj_local_disposable";

function sleep(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function run(command, args, { quiet = false, allowFailure = false } = {}) {
  const result = spawnSync(command, args, { encoding: "utf8" });
  if (result.error) {
    throw new Error(`failed to run ${command}: ${result.error.message}`);
  }
  const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;
  if (!quiet && output.trim()) process.stdout.write(output);
  if (result.status !== 0 && !allowFailure) {
    throw new Error(`${command} ${args.join(" ")} exited with ${result.status}`);
  }
  return { status: result.status, output };
}

function docker(args, options) {
  return run("docker", args, options);
}

function psql(database, args, options) {
  return docker(
    ["exec", "-i", CONTAINER, "psql", "-U", "postgres", "-d", database, "-v", "ON_ERROR_STOP=1", ...args],
    options,
  );
}

function containerState() {
  const { output } = docker(
    ["inspect", "-f", "{{.State.Running}}", CONTAINER],
    { quiet: true, allowFailure: true },
  );
  if (!output.includes("true") && !output.includes("false")) return "missing";
  return output.trim().startsWith("true") ? "running" : "stopped";
}

function ensureContainer() {
  const state = containerState();

  if (state === "missing") {
    console.log(`starting disposable PostgreSQL (${IMAGE}) as ${CONTAINER}...`);
    docker([
      "run", "-d", "--name", CONTAINER,
      "-e", `POSTGRES_PASSWORD=${PG_PASSWORD}`,
      "-p", `${PORT}:5432`,
      IMAGE,
      "-c", "wal_level=logical",
    ], { quiet: true });
  } else if (state === "stopped") {
    console.log(`starting existing container ${CONTAINER}...`);
    docker(["start", CONTAINER], { quiet: true });
  } else {
    console.log(`reusing running container ${CONTAINER}`);
  }

  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) {
    const { status } = docker(["exec", CONTAINER, "pg_isready", "-U", "postgres"], {
      quiet: true,
      allowFailure: true,
    });
    if (status === 0) return;
    sleep(3000);
  }
  throw new Error(`${CONTAINER} did not become ready within 90s`);
}

function resetDatabase() {
  psql("postgres", ["-q", "-c", `drop database if exists ${DB}`], { quiet: true });
  psql("postgres", ["-q", "-c", `create database ${DB}`], { quiet: true });
}

function copyTree(relative, destination) {
  const source = path.join(SUPABASE_DIR, relative);
  docker(["exec", CONTAINER, "rm", "-rf", destination], { quiet: true });
  docker(["exec", CONTAINER, "mkdir", "-p", destination], { quiet: true });
  docker(["cp", `${source}${path.sep}.`, `${CONTAINER}:${destination}`], { quiet: true });
}

function migrationFiles() {
  return readdirSync(MIGRATIONS_DIR)
    .filter((name) => name.endsWith(".sql"))
    .sort();
}

function main() {
  ensureContainer();
  resetDatabase();
  copyTree("migrations", "/jj/migrations");
  copyTree("tests", "/jj/tests");

  console.log("\napplying bootstrap + migrations + fixtures");
  psql(DB, ["-q", "-f", "/jj/tests/bootstrap.sql"], { quiet: true });
  for (const file of migrationFiles()) {
    psql(DB, ["-q", "-f", `/jj/migrations/${file}`], { quiet: true });
    console.log(`  ok  ${file}`);
  }
  psql(DB, ["-q", "-f", "/jj/tests/fixtures.sql"], { quiet: true });

  console.log("\nrunning RLS assertions\n");
  const { status, output } = psql(DB, ["-f", "/jj/tests/rls_assertions.sql"], {
    quiet: true,
    allowFailure: true,
  });
  process.stdout.write(output);

  if (!KEEP) {
    docker(["rm", "-f", CONTAINER], { quiet: true, allowFailure: true });
  }

  if (status !== 0) {
    console.error("\nRLS TESTS FAILED");
    process.exit(1);
  }
  console.log("\nRLS TESTS PASSED");
}

try {
  main();
} catch (error) {
  console.error(`\nharness error: ${error.message}`);
  process.exit(1);
}
