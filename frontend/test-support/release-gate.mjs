#!/usr/bin/env node
/**
 * Release-gate regression suite for `scripts/build-android.mjs`.
 *
 * The release gate is the thing that stops an APK being built against an origin that
 * cannot work from a phone on the open internet (a loopback/LAN address, a single-label
 * hostname, a reserved local suffix, or plain HTTP). A gate like that is only worth
 * having if it is actually exercised, so this drives the REAL script through its
 * `--print-config` path - which resolves configuration, runs the gate and exits before
 * any file is written or any build tool is invoked - and asserts the decision for each
 * case.
 *
 * Nothing here is a credential. The JWT-shaped strings are synthetic: this file only
 * tests whether the script reads a `role` claim, not whether a real key exists.
 *
 * Run with `npm run test:release-gate`.
 */
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const frontendRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const script = join(frontendRoot, "scripts", "build-android.mjs");

function base64url(value) {
  return Buffer.from(JSON.stringify(value))
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

const HEADER = base64url({ alg: "HS256", typ: "JWT" });
// Synthetic, unsigned: the gate reads the claim without verifying the signature.
const ANON_KEY = `${HEADER}.${base64url({ role: "anon", ref: "synthetic" })}.SYNTHETIC-NOT-A-CREDENTIAL`;
const SERVICE_KEY = `${HEADER}.${base64url({ role: "service_role", ref: "synthetic" })}.SYNTHETIC-NOT-A-CREDENTIAL`;
// Newer Supabase key formats are opaque, not JWTs. Both must be classified correctly.
const PUBLISHABLE_KEY = "sb_publishable_SYNTHETIC_N0tACredential";
const SECRET_KEY = "sb_secret_SYNTHETIC_N0tACredential";
const PUBLIC_URL = "https://abcdefgh.supabase.co";

/** [label, url, key, shouldBlock, expectedFragmentInLog] */
const CASES = [
  ["a loopback hostname is refused", "https://localhost", ANON_KEY, true, "loopback/LAN"],
  ["a trailing-dot FQDN does not bypass the loopback check", "https://localhost.", ANON_KEY, true, "loopback/LAN"],
  ["a single-label host is refused", "https://myserver", ANON_KEY, true, "not publicly resolvable"],
  ["a reserved .internal suffix is refused", "https://db.internal", ANON_KEY, true, "not publicly resolvable"],
  ["a reserved .local suffix is refused", "https://supabase.local", ANON_KEY, true, "not publicly resolvable"],
  ["cleartext http is refused", "http://abcdefgh.supabase.co", ANON_KEY, true, "must use https://"],
  ["the emulator host alias is refused", "https://10.0.2.2", ANON_KEY, true, "loopback/LAN"],
  ["private 192.168/16 is refused", "https://192.168.0.104", ANON_KEY, true, "loopback/LAN"],
  ["private 10/8 is refused", "https://10.1.2.3", ANON_KEY, true, "loopback/LAN"],
  ["private 172.16/12 is refused", "https://172.20.5.5", ANON_KEY, true, "loopback/LAN"],
  ["carrier-grade NAT 100.64/10 is refused", "https://100.100.5.5", ANON_KEY, true, "loopback/LAN"],
  ["link-local 169.254/16 is refused", "https://169.254.1.1", ANON_KEY, true, "loopback/LAN"],
  ["IPv4-mapped IPv6 loopback is refused", "https://[::ffff:127.0.0.1]", ANON_KEY, true, "loopback/LAN"],
  ["IPv4-mapped IPv6 private range is refused", "https://[::ffff:192.168.1.10]", ANON_KEY, true, "loopback/LAN"],
  ["IPv6 unique-local fc00::/7 is refused", "https://[fd00::1]", ANON_KEY, true, "loopback/LAN"],
  ["a service_role JWT is refused for any build", PUBLIC_URL, SERVICE_KEY, true, "service_role"],
  ["an opaque secret key is refused for any build", PUBLIC_URL, SECRET_KEY, true, "SECRET key"],
  ["an unknown key role is refused", PUBLIC_URL, `${HEADER}.${base64url({ role: "authenticated" })}.SYNTHETIC`, true, "requires the anon key"],
  ["an unclassifiable key string is refused for a release", PUBLIC_URL, "not-a-key-at-all", true, "publishable key"],
  ["a public https project with an anon JWT is allowed", PUBLIC_URL, ANON_KEY, false, "release gate: ok"],
  ["a publishable key is accepted (not treated as unreadable)", PUBLIC_URL, PUBLISHABLE_KEY, false, "release gate: ok"],
];

let passed = 0;
const failures = [];

for (const [label, url, key, shouldBlock, fragment] of CASES) {
  const result = spawnSync(
    process.execPath,
    [script, "--release", "--print-config", "--supabase-url", url, "--anon-key", key],
    { cwd: frontendRoot, encoding: "utf8" }
  );
  const combined = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
  const blocked = result.status !== 0;
  const problems = [];

  if (blocked !== shouldBlock) {
    problems.push(`expected ${shouldBlock ? "refusal" : "acceptance"}, got the opposite (exit ${result.status})`);
  }
  if (!combined.includes(fragment)) {
    problems.push(`the output did not mention "${fragment}"`);
  }

  if (problems.length === 0) {
    passed += 1;
    console.log(`PASS  ${label}  -  ${shouldBlock ? "refused" : "accepted"}`);
  } else {
    failures.push({ label, problems, combined });
    console.log(`FAIL  ${label}  -  ${problems.join("; ")}`);
  }
}

for (const failure of failures) {
  console.log(`\n--- output for: ${failure.label} ---`);
  console.log(failure.combined.trim().split("\n").slice(-8).join("\n"));
}

console.log(`\nrelease gate: ${passed}/${CASES.length} passed`);
process.exit(failures.length === 0 ? 0 : 1);
