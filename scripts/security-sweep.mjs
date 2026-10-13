#!/usr/bin/env node
//
// Repository-wide security sweep with per-occurrence classification.
//
// This is deliberately not a blanket grep. Every occurrence is printed with the line
// that contains it, and every occurrence must be either clean by construction or
// matched by an explicit allowlist entry that records the file, the pattern and the
// exact number of occurrences plus the reason it is benign. If a file gains one more
// occurrence of an allowlisted pattern, the allowlist stops matching and this fails.
//
// Two failure classes:
//   secret-shaped  - a real credential literal. Never tolerated, in code or in prose.
//   origin-shaped  - a loopback/LAN/cleartext endpoint. Tolerated only in test
//                    fixtures, debug-only source sets and prose; never in shipped
//                    runtime code.
// Identifier mentions (`service_role` as a word) are reported, never blocking: they are
// required server-side and appear in negative assertions.
//
// Usage:
//   node scripts/security-sweep.mjs [--self-test] [--verbose]
//
import { readFileSync, statSync, readdirSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const RUNTIME_ROOTS = [
  "frontend/src",
  "frontend/android/app/src",
  "frontend/scripts",
  "frontend/test-support",
  "frontend/capacitor.config.ts",
  "frontend/vite.config.ts",
  "frontend/index.html",
  "frontend/package.json",
  "frontend/tailwind.config.js",
  "frontend/postcss.config.js",
  "supabase/functions",
  "supabase/migrations",
  "supabase/scripts",
  "supabase/tests",
  "supabase/config.toml",
  "ml",
  "scripts",
  ".github",
];

const PROSE_ROOTS = ["docs", "README.md", "AGENTS.md", "JibonJori_OpenCode_Spec.md", "architecture.txt"];

const SKIP_DIRS = new Set([
  "node_modules",
  ".git",
  "dist",
  "build",
  ".gradle",
  "artifacts",
  ".temp",
  "gradle",
]);
const SKIP_EXT = new Set([".png", ".jpg", ".jpeg", ".webp", ".gif", ".ico", ".ttf", ".woff", ".woff2", ".jar", ".zip", ".apk", ".jks", ".keystore", ".vhdx"]);

// The scanner itself necessarily contains the literals it searches for. It is excluded
// rather than allowlisted; its --self-test proves the detectors still work, so excluding
// the file does not weaken the scan of any other file.
const SELF_EXCLUDE = new Set(["scripts/security-sweep.mjs"]);

const PATTERNS = [
  { id: "secret.sb_secret", kind: "secret", re: /sb_secret_[A-Za-z0-9._-]{12,}/g, what: "Supabase secret key" },
  { id: "secret.sk", kind: "secret", re: /\bsk-[A-Za-z0-9_-]{20,}/g, what: "provider API key" },
  { id: "secret.aiza", kind: "secret", re: /AIza[0-9A-Za-z_-]{30,}/g, what: "Google API key" },
  { id: "secret.jwt", kind: "secret", re: /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g, what: "literal JWT" },
  { id: "secret.pg_uri", kind: "secret", re: /postgres(?:ql)?:\/\/[^\s"'`]+:[^\s"'`@]+@/g, what: "Postgres URI with password" },
  { id: "secret.private_key", kind: "secret", re: /-----BEGIN [A-Z ]*PRIVATE KEY-----/g, what: "private key material" },
  { id: "secret.hardcoded_env", kind: "secret", re: /\b(?:SUPABASE_SERVICE_ROLE_KEY|SUPABASE_SECRET_KEY|DATABASE_URL|DB_PASSWORD|SUPABASE_DB_URL)\s*[:=]\s*["'][^"']{12,}["']/g, what: "hardcoded secret assignment" },
  { id: "origin.loopback_lan", kind: "origin", re: /(?<![0-9A-Za-z.])(?:localhost|127\.0\.0\.1|0\.0\.0\.0|10\.\d{1,3}\.\d{1,3}\.\d{1,3}|192\.168\.\d{1,3}\.\d{1,3}|172\.(?:1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}|100\.(?:6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.\d{1,3}\.\d{1,3})/g, what: "loopback/LAN literal" },
  { id: "origin.cleartext", kind: "origin", re: /http:\/\/(?!(?:schemas\.android\.com|www\.w3\.org|cordova\.apache\.org|d\.android\.com|ns\.adobe\.com)\b)[A-Za-z0-9]/g, what: "cleartext http endpoint" },
  { id: "ident.service_role", kind: "identifier", re: /service_role/g, what: "service_role identifier" },
];

// file (posix, relative to ROOT) :: pattern id -> { count, reason }
//
// Every count below was produced by `--review`, then the listed occurrence was read
// and judged benign. The count is part of the contract: if the file gains one more
// occurrence of that pattern, the allowlist no longer matches and the sweep fails, so
// a new LAN literal or secret literal cannot hide behind an old exemption.
const ALLOW = new Map(
  [
    // --- CI: the local Supabase CLI stack default, which is a documented throwaway ---
    [".github/workflows/ci.yml::origin.loopback_lan", { count: 2, reason: "local Supabase CLI stack default; ephemeral CI container only" }],
    [".github/workflows/ci.yml::secret.pg_uri", { count: 2, reason: "the well-known throwaway local stack URI (postgres:postgres), never a real credential" }],

    // --- Android: debug source set may reach the emulator/loopback; release denies cleartext ---
    ["frontend/android/app/src/debug/res/xml/network_security_config.xml::origin.loopback_lan", { count: 4, reason: "debug-only source set; the main source set denies cleartext outright" }],

    // --- Comments and refusal logic in the build/gate tooling ---
    ["frontend/capacitor.config.ts::origin.loopback_lan", { count: 1, reason: "comment explaining the https://localhost WebView origin" }],
    ["frontend/scripts/build-android.mjs::origin.loopback_lan", { count: 12, reason: "the refusal logic and its pattern table: these are the literals the release gate rejects" }],

    // --- Local-only test harnesses (never shipped in the APK) ---
    ["frontend/test-support/browser-flows.mjs::origin.loopback_lan", { count: 4, reason: "local dev-server harness; never shipped" }],
    ["frontend/test-support/browser-flows.mjs::origin.cleartext", { count: 4, reason: "local dev-server harness; never shipped" }],
    ["frontend/test-support/browser-smoke.mjs::origin.loopback_lan", { count: 4, reason: "local dev-server harness; never shipped" }],
    ["frontend/test-support/browser-smoke.mjs::origin.cleartext", { count: 4, reason: "local dev-server harness; never shipped" }],

    // --- The release gate's own negative fixtures: each literal is a must-refuse case ---
    ["frontend/test-support/release-gate.mjs::origin.loopback_lan", { count: 9, reason: "negative fixtures: every literal is a host the gate must refuse" }],
    ["frontend/test-support/release-gate.mjs::origin.cleartext", { count: 1, reason: "negative fixture: cleartext http must be refused" }],
    ["frontend/test-support/release-gate.mjs::secret.sb_secret", { count: 1, reason: "synthetic sb_secret_SYNTHETIC fixture proving secret keys are rejected" }],

    // --- The APK scanner's pattern table and the finding it documents ---
    ["frontend/test-support/scan-apk.mjs::origin.loopback_lan", { count: 5, reason: "the scanner's own pattern table plus the single documented library finding" }],
    ["frontend/test-support/scan-apk.mjs::origin.cleartext", { count: 3, reason: "the scanner's own pattern table plus the documented library loopback constant" }],

    // --- This scanner is self-referential: its own pattern tables necessarily contain
    // the literals it looks for, so it excludes itself (see SELF_EXCLUDE) instead of
    // allowlisting its own source, which would only ever produce churn. ---

    // --- Supabase CLI local configuration: defaults for a local stack, not production ---
    ["supabase/config.toml::origin.loopback_lan", { count: 6, reason: "Supabase CLI local-stack defaults (0.0.0.0/0 cidr, 127.0.0.1 urls); not used by the cloud client" }],
    ["supabase/config.toml::origin.cleartext", { count: 3, reason: "Supabase CLI local-stack defaults (api_url/site_url); documented as local-only" }],
    ["supabase/functions/.env.example::origin.loopback_lan", { count: 1, reason: "placeholder example origin in a committed template" }],
    ["supabase/functions/.env.example::origin.cleartext", { count: 1, reason: "placeholder example origin in a committed template" }],

    // --- Server-side CORS allowlist for the Capacitor WebView origins ---
    ["supabase/functions/_shared/http.ts::origin.loopback_lan", { count: 3, reason: "CORS allowlist for the Capacitor WebView origins (https/http/capacitor localhost)" }],
    ["supabase/functions/_shared/http.ts::origin.cleartext", { count: 1, reason: "CORS allowlist entry for the Capacitor http://localhost WebView origin" }],

    // --- Placeholder shapes in operator help text, not values ---
    ["supabase/scripts/cloud.mjs::secret.hardcoded_env", { count: 2, reason: "placeholder env-assignment shapes in help text" }],
    ["supabase/scripts/cloud.mjs::secret.pg_uri", { count: 1, reason: "placeholder URI shape with <ref>/<password> placeholders" }],
    ["supabase/scripts/verify-cloud-runtime.mjs::secret.hardcoded_env", { count: 2, reason: "placeholder env-assignment shapes in harness documentation" }],

    // --- Edge Function behavioural tests: fixtures that must contain the very
    // literals under test. The Capacitor origins are what the CORS allowlist must
    // ACCEPT, and the Postgres URI is a synthetic string used to prove the error
    // handler does not leak it. Neither is a credential or a configured origin. ---
    ["supabase/functions/tests/http_test.ts::origin.loopback_lan", { count: 4, reason: "synthetic CORS fixtures: the Capacitor origins the allowlist must accept" }],
    ["supabase/functions/tests/http_test.ts::origin.cleartext", { count: 1, reason: "synthetic CORS fixture: the Capacitor http://localhost origin" }],
    ["supabase/functions/tests/http_test.ts::secret.pg_uri", { count: 1, reason: "synthetic URI used to prove the 500 handler does not leak the message" }],

    // --- Prose: placeholders and the synthetic fixture are named, never valued ---
    ["docs/FINAL_SUPABASE_PHONE_VERIFICATION_REPORT.md::secret.hardcoded_env", { count: 1, reason: "placeholder <service_role key> in setup instructions" }],
    ["docs/FINAL_SUPABASE_PHONE_VERIFICATION_REPORT.md::secret.sb_secret", { count: 1, reason: "names the synthetic fixture, which is not a credential" }],
    ["docs/SUPABASE_CLOUD_SETUP.md::secret.hardcoded_env", { count: 2, reason: "placeholder <service_role key> in setup instructions" }],
    ["docs/FINAL_SUPABASE_MIGRATION_COMPLETION_REPORT.md::secret.hardcoded_env", { count: 1, reason: "placeholder <service_role key> in deployment instructions" }],
    ["docs/SUPABASE_MIGRATION_LEDGER.md::secret.sb_secret", { count: 1, reason: "names the synthetic fixture, which is not a credential" }],
  ].map(([k, v]) => [k, v])
);

function walk(absPath, out) {
  let st;
  try {
    st = statSync(absPath);
  } catch {
    return out;
  }
  if (!st.isDirectory()) {
    const ext = absPath.slice(absPath.lastIndexOf("."));
    if (!SKIP_EXT.has(ext.toLowerCase())) out.push(absPath);
    return out;
  }
  for (const entry of readdirSync(absPath, { withFileTypes: true })) {
    if (entry.isDirectory() && SKIP_DIRS.has(entry.name)) continue;
    walk(join(absPath, entry.name), out);
  }
  return out;
}

function collect(roots) {
  const files = [];
  for (const r of roots) walk(resolve(ROOT, r), files);
  return files.filter((f) => !SELF_EXCLUDE.has(posix(f)));
}

function posix(p) {
  return relative(ROOT, p).split(sep).join("/");
}

function isBinary(text) {
  return text.includes("\u0000");
}

function classify(files, isProse) {
  const occurrences = [];
  for (const file of files) {
    let text;
    try {
      text = readFileSync(file, "utf8");
    } catch {
      continue;
    }
    if (isBinary(text)) continue;
    const rel = posix(file);
    const lines = text.split(/\r?\n/);
    for (const pattern of PATTERNS) {
      if (isProse && pattern.kind !== "secret") continue;
      for (let i = 0; i < lines.length; i++) {
        const found = lines[i].match(pattern.re);
        if (!found) continue;
        for (const token of found) {
          const key = `${rel}::${pattern.id}`;
          occurrences.push({
            file: rel,
            line: i + 1,
            pattern: pattern.id,
            kind: pattern.kind,
            what: pattern.what,
            token: token.length > 40 ? `${token.slice(0, 37)}...` : token,
            text: lines[i].trim().slice(0, 160),
            key,
          });
        }
      }
    }
  }

  const usedCount = new Map();
  for (const o of occurrences) usedCount.set(o.key, (usedCount.get(o.key) ?? 0) + 1);

  for (const o of occurrences) {
    const allow = ALLOW.get(o.key);
    if (o.kind === "identifier") {
      o.verdict = "reported";
      o.reason = allow ? allow.reason : "identifier mention outside the allowlist (still non-blocking)";
      continue;
    }
    const declared = usedCount.get(o.key);
    if (allow && allow.count === declared) {
      o.verdict = "allowlisted";
      o.reason = allow.reason;
    } else if (allow && allow.count !== declared) {
      o.verdict = "blocking";
      o.reason = `allowlist declares ${allow.count} occurrence(s) of ${o.pattern} for this file but ${declared} were found`;
    } else {
      o.verdict = "blocking";
      o.reason = "no allowlist entry";
    }
  }

  const blocking = occurrences.filter((o) => o.verdict === "blocking");
  return { occurrences, blocking, usedCount };
}

function summarize(label, result, verbose) {
  const allowed = result.occurrences.filter((o) => o.verdict === "allowlisted");
  const reported = result.occurrences.filter((o) => o.verdict === "reported");
  console.log(`${label}: occurrences=${result.occurrences.length} allowlisted=${allowed.length} reported=${reported.length} BLOCKING=${result.blocking.length}`);
  if (process.argv.includes("--review")) {
    const groups = new Map();
    for (const o of result.occurrences) {
      if (o.kind === "identifier") continue;
      const g = groups.get(o.key) ?? { count: 0, examples: [] };
      g.count += 1;
      if (g.examples.length < 2) g.examples.push(`${o.file}:${o.line} "${o.text}"`);
      groups.set(o.key, g);
    }
    for (const [key, g] of [...groups].sort()) {
      console.log(`  ${key}  => count ${g.count}`);
      for (const e of g.examples) console.log(`      ${e}`);
    }
    return result.blocking;
  }
  if (verbose || result.blocking.length > 0) {
    for (const o of result.occurrences) {
      const tag = o.verdict === "blocking" ? "BLOCKING" : o.verdict.toUpperCase();
      console.log(`  [${tag}] ${o.file}:${o.line} ${o.pattern} -> ${o.token}`);
      console.log(`      ${o.what}: ${o.reason}`);
      console.log(`      ${o.text}`);
    }
  } else {
    const byFile = new Map();
    for (const o of result.occurrences) {
      byFile.set(o.file, (byFile.get(o.file) ?? 0) + 1);
    }
    for (const [f, n] of [...byFile].sort()) console.log(`  ok ${f} (${n})`);
  }
  return result.blocking;
}

const verbose = process.argv.includes("--verbose");
const runtime = classify(collect(RUNTIME_ROOTS), false);
const prose = classify(collect(PROSE_ROOTS), true);

console.log(`scanner self-exclusion: ${[...SELF_EXCLUDE].join(", ")} (contains its own detection literals; --self-test proves the detectors fire)`);
console.log("");

const blocking = [...summarize("runtime", runtime, verbose), ...summarize("prose", prose, verbose)];

let selfTestOk = true;
if (process.argv.includes("--self-test")) {
  console.log("");
  console.log("self-test (proves the detector fires on injected defects):");
  const cases = [
    { name: "a real secret key in a source file", file: "frontend/src/lib/evil.ts", line: "const k = 'sb_secret_abcdefghijklmnopqrstuvwx';" },
    { name: "a LAN origin in shipped runtime code", file: "frontend/src/lib/evil.ts", line: "export const base = 'http://192.168.1.50:4000/api';" },
    { name: "a hardcoded service-role assignment", file: "frontend/src/lib/evil.ts", line: "const SUPABASE_SERVICE_ROLE_KEY = 'abc1234567890def';" },
    { name: "a Postgres URI with an inline password", file: "frontend/src/lib/evil.ts", line: "const u = 'postgresql://postgres:supersecret@db.host:5432/postgres';" },
  ];
  for (const c of cases) {
    const synthetic = classify([resolve(ROOT, "scripts", "self-test-synthetic.txt")], false);
    void synthetic;
    const occurrences = [];
    for (const pattern of PATTERNS) {
      const found = c.line.match(pattern.re);
      if (found) {
        for (const token of found) {
          occurrences.push({ key: `${c.file}::${pattern.id}`, kind: pattern.kind, pattern: pattern.id, token });
        }
      }
    }
    const caught = occurrences.some(
      (o) => o.kind !== "identifier" && !ALLOW.has(o.key)
    );
    selfTestOk = selfTestOk && caught;
    console.log(`  ${caught ? "detected" : "MISSED  "} ${c.name}${caught ? "" : " <-- detector gap"}`);
  }
}

if (blocking.length > 0 || !selfTestOk) {
  console.error("");
  console.error("SECURITY SWEEP FAILED");
  process.exit(1);
}
console.log("");
console.log("SECURITY SWEEP PASSED");
