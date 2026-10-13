#!/usr/bin/env node
/**
 * Build an Android APK of the JibonJori frontend. The default is a debug APK for local
 * manual phone testing; `--release` builds a gated release APK instead.
 *
 * What it does, in order:
 *   1. resolves the Supabase project URL and anon key the APK must talk to (CLI flags,
 *      then process env, then `.env.phone` / `.env.phone.local` / `.env`);
 *   2. rejects a service_role key outright, because inlining one would hand every
 *      installer full database access;
 *   3. checks the Android/JDK toolchain and fails with the exact prerequisite that is
 *      missing instead of pretending an APK was produced;
 *   4. rewrites the debug-only cleartext allowlist so only the configured Supabase host
 *      is reachable over plain HTTP (needed only for a local `supabase start`);
 *   5. validates and builds the React app (typecheck, lint, `vite build --mode phone`);
 *   6. copies the web build into the Android project (`cap sync android`);
 *   7. assembles the APK with the Gradle wrapper;
 *   8. prints the APK path and size.
 *
 * It reads no secret and writes none: the only values baked into the bundle are the
 * public Supabase URL and anon API key, both of which are designed to ship in a client.
 * Machine-specific values go to `.env.phone.local`, git-ignored.
 *
 * The toolchain commands are the project's own binaries, invoked directly with Node so
 * that no shell quoting is involved (on Windows, spawning a `.cmd`/`.bat` without a shell
 * is refused by modern Node). Each is the exact command its `npm run` script runs.
 *
 * Usage:
 *   npm run build:android
 *   npm run build:android -- --supabase-url https://abc.supabase.co --anon-key eyJ...
 *   VITE_SUPABASE_URL=https://abc.supabase.co npm run build:android
 *   npm run build:android:release -- --supabase-url https://abc.supabase.co
 *
 * Release gate (--release): `VITE_SUPABASE_URL` must be https:// on a publicly routable
 * host, and the anon key must be a JWT whose `role` claim is `anon`. Cleartext, loopback
 * (localhost/127.0.0.1/::1/0.0.0.0), the emulator alias 10.0.2.2 and every private range
 * (10/8, 172.16/12, 192.168/16, 169.254/16) are rejected, because an APK built against
 * those could never reach a backend outside the developer's own network. The gate fails
 * closed: with no public https:// Supabase URL, no release APK is produced at all.
 */
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const frontendRoot = resolve(here, "..");
const androidRoot = join(frontendRoot, "android");
const isWindows = process.platform === "win32";

function log(message) {
  process.stdout.write(`${message}\n`);
}

function fail(message) {
  process.stderr.write(`\n[build:android] ERROR: ${message}\n`);
  process.exit(1);
}

/** Runs a command with no shell, streaming its output, and returns the exit code. */
function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    stdio: "inherit",
    cwd: options.cwd ?? frontendRoot,
    env: { ...process.env, ...(options.env ?? {}) },
    shell: false,
  });
  if (result.error) {
    fail(`could not run "${command}": ${result.error.message}`);
  }
  return result.status ?? 1;
}

/** Runs a command and captures stdout/stderr as text. */
function runCapture(command, args, options = {}) {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    shell: false,
    cwd: options.cwd ?? frontendRoot,
  });
  return {
    status: result.status ?? 1,
    stdout: (result.stdout ?? "").trim(),
    stderr: (result.stderr ?? "").trim(),
  };
}

/**
 * Locates a usable JDK 17+ home directory.
 *
 * `JAVA_HOME` is trusted only if it actually contains `bin/java`, because a stale
 * `JAVA_HOME` left behind by a JDK reinstall is common and Gradle fails confusingly when it
 * points at a directory that no longer exists. When it is unusable, the JDK is derived from
 * whichever `java` the shell resolves on `PATH`, and that path is used for the build.
 */
function resolveJavaHome() {
  const executable = isWindows ? "java.exe" : "java";
  const candidates = [];

  if (process.env.JAVA_HOME) candidates.push(process.env.JAVA_HOME.replace(/[\\/]+$/, ""));

  const which = runCapture(isWindows ? "where.exe" : "which", ["java"]);
  if (which.status === 0) {
    for (const line of which.stdout.split(/\r?\n/)) {
      const found = line.trim();
      if (found.length === 0) continue;
      // .../jdk/bin/java(.exe) -> jdk home
      candidates.push(dirname(dirname(found)));
    }
  }

  for (const candidate of candidates) {
    if (candidate && existsSync(join(candidate, "bin", executable))) {
      return candidate;
    }
  }
  return undefined;
}

/** A local binary under node_modules, or a clear failure if the dependency is absent. */
function localBin(relativePath) {
  const full = join(frontendRoot, relativePath);
  if (!existsSync(full)) {
    fail(
      `missing ${relativePath}.\n` +
        "  Run \"npm install\" in frontend/ first (the dependency tree is incomplete)."
    );
  }
  return full;
}

/** Runs the Gradle wrapper. On Windows it is a .bat, so cmd.exe runs it for us. */
function runGradle(args) {
  if (isWindows) {
    const comSpec = process.env.ComSpec ?? "C:\\WINDOWS\\system32\\cmd.exe";
    return run(comSpec, ["/d", "/s", "/c", `gradlew.bat ${args.join(" ")}`], { cwd: androidRoot });
  }
  return run("./gradlew", args, { cwd: androidRoot });
}

/** Reads `KEY=value` pairs from a dotenv-style file, ignoring comments and blanks. */
function readEnvFile(path) {
  if (!existsSync(path)) return {};
  const out = {};
  for (const rawLine of readFileSync(path, "utf8").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line.length === 0 || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    const value = line.slice(eq + 1).trim().replace(/^["']|["']$/g, "");
    out[key] = value;
  }
  return out;
}

/**
 * Parses the supported CLI flags. There is deliberately no LAN-address guessing any
 * more: a hosted Supabase URL is a project value, and a local `supabase start` host is
 * passed explicitly with `--supabase-url http://<lan-ip>:54321`, so the build can never
 * silently bake a URL nobody chose.
 */
function parseArgs(argv) {
  const parsed = { supabaseUrl: undefined, anonKey: undefined, printConfig: false, release: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--supabase-url") parsed.supabaseUrl = argv[++i];
    else if (arg === "--anon-key") parsed.anonKey = argv[++i];
    else if (arg === "--print-config") parsed.printConfig = true;
    else if (arg === "--release") parsed.release = true;
    else
      fail(
        `unknown argument "${arg}". Known flags: --supabase-url, --anon-key, --print-config, --release`
      );
  }
  return parsed;
}

/** Trailing slashes are stripped so the bundle never contains `https://host//rest`. */
function normalizeUrl(value) {
  return String(value ?? "").trim().replace(/\/+$/, "");
}

/** Extracts the hostname from a URL without throwing on malformed input. */
function hostOf(url) {
  try {
    return new URL(url).hostname;
  } catch {
    return undefined;
  }
}

/**
 * Decodes the payload of a Supabase API key (a JWT) without verifying it.
 *
 * Verification is the server's job and the signature cannot be checked here; what this
 * must establish is the *claim*, because shipping a `service_role` key in a client
 * bundle bypasses row level security for every installer of the APK.
 */
function decodeKeyClaims(key) {
  const parts = String(key ?? "").trim().split(".");
  if (parts.length !== 3) return undefined;
  try {
    const payload = Buffer.from(parts[1].replace(/-/g, "+").replace(/_/g, "/"), "base64").toString(
      "utf8"
    );
    return JSON.parse(payload);
  } catch {
    return undefined;
  }
}

/** The `role` claim of a Supabase API key, or undefined when it is not a readable JWT. */
function keyRole(key) {
  const claims = decodeKeyClaims(key);
  return typeof claims?.role === "string" ? claims.role : undefined;
}

/**
 * Classifies a Supabase API key.
 *
 * Supabase issues two key formats and the client accepts both, so the build must too:
 *
 *   * a legacy JWT API key, whose `role` claim is `anon` or `service_role`;
 *   * a newer opaque key: `sb_publishable_...` (safe in a client, the successor to the
 *     anon key) or `sb_secret_...` (never in a client, the successor to service_role).
 *
 * Treating a publishable key as "not a readable JWT" would refuse a perfectly valid
 * release build, so it is recognised explicitly. Treating a secret key as acceptable
 * would defeat the whole check, so it is refused explicitly.
 */
function keyKind(key) {
  const value = String(key ?? "").trim();
  if (value.startsWith("sb_secret_")) return { kind: "secret" };
  if (value.startsWith("sb_publishable_")) return { kind: "publishable" };
  const role = keyRole(value);
  if (role) return { kind: "jwt", role };
  return { kind: "unknown" };
}

const args = parseArgs(process.argv.slice(2));

// ------------------------------------------------------------ Supabase configuration
const phoneLocalPath = join(frontendRoot, ".env.phone.local");
const phonePath = join(frontendRoot, ".env.phone");
const defaultEnvPath = join(frontendRoot, ".env");
const fileEnv = {
  ...readEnvFile(defaultEnvPath),
  ...readEnvFile(phonePath),
  ...readEnvFile(phoneLocalPath),
};

function resolveSupabase() {
  const explicitUrl = normalizeUrl(
    args.supabaseUrl ?? process.env.VITE_SUPABASE_URL ?? fileEnv.VITE_SUPABASE_URL
  );
  const anonKey = String(
    args.anonKey ?? process.env.VITE_SUPABASE_ANON_KEY ?? fileEnv.VITE_SUPABASE_ANON_KEY ?? ""
  ).trim();

  if (explicitUrl.length > 0) {
    return {
      url: explicitUrl,
      anonKey,
      source: args.supabaseUrl ? "--supabase-url flag" : "configuration",
    };
  }

  return { url: "", anonKey, source: "unconfigured" };
}

const supabase = resolveSupabase();

const supabaseHost = hostOf(supabase.url);
const plainHttp = supabase.url.startsWith("http://");

if (supabase.url.length === 0) {
  fail(
    "no Supabase project was configured.\n" +
      "  Set the two public values the client needs:\n" +
      "    npm run build:android -- --supabase-url https://<project-ref>.supabase.co --anon-key <anon-key>\n" +
      "  or put VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY in frontend/.env.phone.local\n" +
      "  (see .env.phone.example). Both are public; the service_role key must never be used here."
  );
}
if (supabaseHost === undefined) {
  fail(`"${supabase.url}" is not a valid URL. Pass a full origin, e.g. https://abc.supabase.co`);
}
if (!/^https?:\/\//.test(supabase.url)) {
  fail(`"${supabase.url}" must start with http:// or https://`);
}
if (supabase.anonKey.length === 0) {
  fail(
    "no Supabase anon key was configured.\n" +
      "  Pass --anon-key, or set VITE_SUPABASE_ANON_KEY (see .env.phone.example).\n" +
      "  Use the *anon* key: it is public and constrained by row level security."
  );
}

// A secret or service_role key in a client bundle disables row level security for
// anyone who unzips the APK and reads the JavaScript, which defeats every table policy
// at once. This is checked before anything is built, for debug and release builds alike.
const key = keyKind(supabase.anonKey);
const role = key.kind === "jwt" ? key.role : undefined;
const keyDescription =
  key.kind === "secret"
    ? "a Supabase SECRET key (sb_secret_...)"
    : key.kind === "publishable"
      ? "a Supabase publishable key (sb_publishable_...)"
      : key.kind === "jwt"
        ? `a JWT API key (role=${key.role})`
        : "an unrecognised key format";

if (key.kind === "secret" || role === "service_role") {
  fail(
    `the configured key is ${keyDescription}.\n` +
      "  Refusing to build: it would be inlined into the APK bundle and grant full\n" +
      "  database access to every installer, bypassing row level security.\n" +
      "  Use the anon / publishable (public) key instead."
  );
}
if (key.kind === "jwt" && role !== "anon") {
  fail(`the configured key has role "${role}"; the client requires the anon key.`);
}

/**
 * Release builds are the ones that leave the machine, so the Supabase origin they carry
 * must be publicly reachable and encrypted. Anything private, loopback or cleartext can
 * only ever have been a local development target, and shipping it would either fail
 * silently on the phone or send credentials in the clear.
 *
 * Returns the list of reasons the build must not proceed; an empty list means it may.
 */
const LOOPBACK_OR_LAN_HOSTS = new Set([
  "localhost",
  "127.0.0.1",
  "0.0.0.0",
  "::",
  "::1",
  "10.0.2.2",
]);

/**
 * DNS suffixes that are defined to be local, reserved or documentation-only. A host
 * under any of these cannot be resolved from a phone on the open internet, so a release
 * build pointed at one would install and then fail every request.
 */
const NON_PUBLIC_SUFFIXES = [
  ".local",
  ".localhost",
  ".localdomain",
  ".lan",
  ".internal",
  ".home.arpa",
  ".test",
  ".invalid",
  ".example",
  ".onion",
];

function hostnameOf(url) {
  const host = hostOf(url);
  if (typeof host !== "string") return undefined;
  // Strip IPv6 brackets and the root label of an absolute FQDN ("localhost." -> "localhost"),
  // which would otherwise slip past a plain string comparison.
  return host.replace(/^\[|\]$/g, "").replace(/\.$/, "").toLowerCase();
}

function isPrivateOrLoopback(host) {
  if (LOOPBACK_OR_LAN_HOSTS.has(host)) return true;

  // IPv6: loopback, link-local, unique-local (fc00::/7), and IPv4-mapped forms of the
  // IPv4 ranges below. An IPv4-mapped address reaches exactly the same place as its IPv4
  // form, so it must be judged by the same rules.
  if (host.includes(":")) {
    if (/^fe80:/.test(host) || /^f[cd][0-9a-f]{2}:/.test(host)) return true;
    // An IPv4-mapped address reaches exactly the same place as its IPv4 form, so it is
    // judged by the same rules. `new URL()` rewrites the dotted form to hex groups
    // (::ffff:127.0.0.1 becomes ::ffff:7f00:1), so both spellings are handled.
    const dotted = host.match(/^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/);
    if (dotted) return isPrivateOrLoopback(dotted[1]);
    const hexMapped = host.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
    if (hexMapped) {
      const hi = parseInt(hexMapped[1], 16);
      const lo = parseInt(hexMapped[2], 16);
      return isPrivateOrLoopback(`${hi >> 8}.${hi & 0xff}.${lo >> 8}.${lo & 0xff}`);
    }
    return false;
  }

  const v4 = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!v4) return false;
  const [a, b] = [Number(v4[1]), Number(v4[2])];
  return (
    a === 0 || // "this network"
    a === 10 || // private
    a === 127 || // loopback
    (a === 100 && b >= 64 && b <= 127) || // carrier-grade NAT
    (a === 169 && b === 254) || // link-local
    (a === 172 && b >= 16 && b <= 31) || // private
    (a === 192 && b === 168) || // private
    (a === 198 && (b === 18 || b === 19)) // benchmarking
  );
}

/**
 * A host that cannot be reached over the public internet for naming reasons rather than
 * addressing ones: a single label has no public DNS zone, and the reserved suffixes above
 * belong to local or documentation use. Both pass an "is not a private IP" test, so they
 * are checked separately or the gate would wave them through.
 */
function isNonRoutableName(host) {
  if (host.includes(":")) return false;
  if (!host.includes(".")) return true;
  return NON_PUBLIC_SUFFIXES.some((suffix) => host === suffix.slice(1) || host.endsWith(suffix));
}

/** The release source set's network policy, which must deny cleartext. */
function releaseDeniesCleartext() {
  const configPath = join(androidRoot, "app", "src", "main", "res", "xml", "network_security_config.xml");
  if (!existsSync(configPath)) return { ok: false, reason: `missing ${configPath}` };
  const text = readFileSync(configPath, "utf8");
  if (/cleartextTrafficPermitted\s*=\s*"true"/.test(text)) {
    return { ok: false, reason: "the main network_security_config.xml permits cleartext traffic" };
  }
  return { ok: true };
}

function releaseBlockers() {
  const blockers = [];
  const label = "VITE_SUPABASE_URL";
  if (!supabase.url.startsWith("https://")) {
    blockers.push(`${label} "${supabase.url}" must use https:// - a release build refuses cleartext HTTP`);
    return blockers;
  }
  const host = hostnameOf(supabase.url);
  if (host === undefined) {
    blockers.push(`${label} "${supabase.url}" is not a valid URL`);
    return blockers;
  }
  if (isPrivateOrLoopback(host)) {
    blockers.push(`${label} host "${host}" is a loopback/LAN address and cannot be reached from the internet`);
  }
  if (isNonRoutableName(host)) {
    blockers.push(
      `${label} host "${host}" is not publicly resolvable (a single label or a reserved suffix such as .local/.internal)`
    );
  }
  if (key.kind === "unknown") {
    blockers.push(
      "--anon-key is neither a publishable key (sb_publishable_...) nor a readable anon JWT, so it could not be confirmed as a public client key"
    );
  }
  const cleartext = releaseDeniesCleartext();
  if (!cleartext.ok) {
    blockers.push(`release network policy: ${cleartext.reason}`);
  }
  return blockers;
}

log(`=== JibonJori Android ${args.release ? "release" : "debug"} APK build ===`);
log(`supabase url : ${supabase.url}`);
log(`               (${supabase.source})`);
log(`supabase anon: present (${keyDescription})`);
log(`supabase host: ${supabaseHost}   plain HTTP: ${plainHttp ? "yes (local test only)" : "no"}`);

const blockers = args.release ? releaseBlockers() : [];
if (args.release && blockers.length > 0) {
  log(`release gate: REFUSED (${blockers.length} blocker${blockers.length === 1 ? "" : "s"})`);
  for (const blocker of blockers) log(`  - ${blocker}`);
} else if (args.release) {
  log("release gate: ok (https on a publicly routable host)");
}
if (args.printConfig) {
  log("--print-config: stopping after configuration resolution.");
  process.exit(blockers.length > 0 ? 2 : 0);
}
if (blockers.length > 0) {
  fail(
    `refusing to build a release APK that cannot work over the public internet:\n` +
      blockers.map((blocker) => `  - ${blocker}`).join("\n") +
      "\n\n  Point the build at the hosted Supabase project first, then run:\n" +
      "    npm run build:android:release -- --supabase-url https://<project-ref>.supabase.co\n" +
      "  A phone-test APK must not be produced while no public URL exists."
  );
}

// ------------------------------------------------------------------- toolchain checks
function checkToolchain() {
  const problems = [];

  const declaredJavaHome = (process.env.JAVA_HOME ?? "").replace(/[\\/]+$/, "");
  const javaHome = resolveJavaHome();
  if (!javaHome) {
    problems.push(
      "no usable JDK was found.\n" +
        "      Capacitor 6 / AGP 8.2 needs JDK 17. Install Temurin 17 and either set JAVA_HOME\n" +
        "      to its directory or put its bin/ on PATH."
    );
  } else {
    if (declaredJavaHome && declaredJavaHome !== javaHome) {
      log(`java note   : JAVA_HOME is "${declaredJavaHome}", which does not contain bin/java;`);
      log(`              using "${javaHome}" instead (resolved from PATH).`);
    }
    // Gradle and AGP read JAVA_HOME, so correct it for every child process. This changes
    // nothing on the machine; it only fixes the environment of this build.
    process.env.JAVA_HOME = javaHome;
    const javaBin = join(javaHome, "bin", isWindows ? "java.exe" : "java");
    const version = runCapture(javaBin, ["-version"]);
    const text = `${version.stdout} ${version.stderr}`;
    const match = text.match(/version "(\d+)/);
    const major = match ? Number(match[1]) : NaN;
    log(`java        : ${match ? `major ${major}` : "unknown version"} (${javaHome})`);
    if (Number.isFinite(major) && major < 17) {
      problems.push(`JDK ${major} is too old for AGP 8.2. JDK 17 or newer is required.`);
    }
  }

  const sdkRoot = process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT;
  if (!sdkRoot || !existsSync(sdkRoot)) {
    problems.push(
      "ANDROID_HOME (or ANDROID_SDK_ROOT) is not set to an existing Android SDK.\n" +
        "      Install the Android command-line tools and set ANDROID_HOME."
    );
  } else {
    log(`android sdk : ${sdkRoot}`);
    const platformsDir = join(sdkRoot, "platforms");
    const platforms = existsSync(platformsDir) ? readdirSync(platformsDir) : [];
    const variables = existsSync(join(androidRoot, "variables.gradle"))
      ? readFileSync(join(androidRoot, "variables.gradle"), "utf8")
      : "";
    const wants = variables.match(/compileSdkVersion\s*=\s*(\d+)/);
    const requiredPlatform = wants ? `android-${wants[1]}` : undefined;
    log(`platforms   : ${platforms.join(", ") || "(none)"}`);
    if (requiredPlatform && !platforms.includes(requiredPlatform)) {
      problems.push(
        `the Android platform ${requiredPlatform} is missing.\n` +
          `      Install it:  sdkmanager "platforms;${requiredPlatform}"`
      );
    }
    const buildToolsDir = join(sdkRoot, "build-tools");
    const buildTools = existsSync(buildToolsDir) ? readdirSync(buildToolsDir) : [];
    log(`build-tools : ${buildTools.join(", ") || "(none)"}`);
    if (buildTools.length === 0) {
      problems.push(
        'no Android build-tools installed. Install one:  sdkmanager "build-tools;34.0.0"'
      );
    }
    const adb = join(sdkRoot, "platform-tools", isWindows ? "adb.exe" : "adb");
    log(`adb         : ${existsSync(adb) ? adb : "NOT FOUND (only needed to install on a device)"}`);
  }

  const wrapper = join(androidRoot, isWindows ? "gradlew.bat" : "gradlew");
  if (!existsSync(wrapper)) {
    problems.push(
      `no Gradle wrapper at ${wrapper}.\n      Run "npx cap add android" in frontend/ first.`
    );
  }
  if (!existsSync(join(androidRoot, "app", "build.gradle"))) {
    problems.push("the Android platform is missing (frontend/android/app/build.gradle not found).");
  }

  if (problems.length > 0) {
    fail(`the Android toolchain is not ready:\n    - ${problems.join("\n    - ")}`);
  }
}

checkToolchain();

// `local.properties` is git-ignored and lets Gradle find the SDK even when it is invoked
// outside a shell that exports ANDROID_HOME.
const localProperties = join(androidRoot, "local.properties");
const sdkRootForGradle = process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT;
if (sdkRootForGradle && !existsSync(localProperties)) {
  const escaped = sdkRootForGradle.replace(/\\/g, "\\\\").replace(/:/g, "\\:");
  writeFileSync(
    localProperties,
    "## Generated locally by scripts/build-android.mjs; git-ignored. Do not commit.\n" +
      `sdk.dir=${escaped}\n`
  );
  log("wrote       : android/local.properties (sdk.dir)");
}

// ------------------------------------------------- debug cleartext allowlist (per-host)
function writeCleartextConfig() {
  const configPath = join(
    androidRoot,
    "app",
    "src",
    "debug",
    "res",
    "xml",
    "network_security_config.xml"
  );
  if (!existsSync(configPath)) {
    fail(
      `missing ${configPath}.\n` +
        "  It is part of the wrapper and must exist before a debug APK can be built."
    );
  }

  const current = readFileSync(configPath, "utf8");
  const block = /    <!-- BEGIN GENERATED-LAN-HOST -->[\s\S]*?    <!-- END GENERATED-LAN-HOST -->/;
  if (!block.test(current)) {
    fail(
      `could not find the GENERATED-LAN-HOST markers in ${configPath}.\n` +
        "  Restore the file before building."
    );
  }

  if (!plainHttp) {
    writeFileSync(
      configPath,
      current.replace(
        block,
        [
          "    <!-- BEGIN GENERATED-LAN-HOST -->",
          "    <!-- The configured Supabase URL uses HTTPS, so no cleartext host is permitted. -->",
          "    <!-- END GENERATED-LAN-HOST -->",
        ].join("\n")
      )
    );
    log("cleartext   : not needed (HTTPS Supabase); debug allowlist cleared");
    return;
  }

  writeFileSync(
    configPath,
    current.replace(
      block,
      [
        "    <!-- BEGIN GENERATED-LAN-HOST -->",
        "    <!-- Rewritten by `npm run build:android` from the configured Supabase URL. -->",
        `    <!-- Local supabase-start host for this build: ${supabaseHost} -->`,
        '    <domain-config cleartextTrafficPermitted="true">',
        `        <domain includeSubdomains="false">${supabaseHost}</domain>`,
        "    </domain-config>",
        "    <!-- END GENERATED-LAN-HOST -->",
      ].join("\n")
    )
  );
  log(`cleartext   : permitted for ${supabaseHost} in the DEBUG build only`);
}

writeCleartextConfig();

// ------------------------------------------------------- machine-local, git-ignored env
writeFileSync(
  phoneLocalPath,
  [
    "# Generated by `npm run build:android`. Machine-specific; git-ignored.",
    "# These two public values are the only backend configuration baked into the APK.",
    `VITE_SUPABASE_URL=${supabase.url}`,
    `VITE_SUPABASE_ANON_KEY=${supabase.anonKey}`,
    "",
  ].join("\n")
);
log("wrote       : frontend/.env.phone.local");

// ------------------------------------------------------------------- frontend validation
const tsc = localBin("node_modules/typescript/bin/tsc");
const eslint = localBin("node_modules/eslint/bin/eslint.js");
const vite = localBin("node_modules/vite/bin/vite.js");
const capacitor = localBin("node_modules/@capacitor/cli/bin/capacitor");

log("\n--- frontend validation (same commands as `npm run typecheck` / `npm run lint`) ---");
log("> tsc -p tsconfig.json --noEmit");
if (run(process.execPath, [tsc, "-p", "tsconfig.json", "--noEmit"]) !== 0) {
  fail("frontend typecheck failed. The APK was not built.");
}
log("> eslint .");
if (run(process.execPath, [eslint, "."]) !== 0) {
  fail("frontend lint failed. The APK was not built.");
}

log("\n--- React production build (mode: phone) ---");
const distDir = join(frontendRoot, "dist");
if (existsSync(distDir)) {
  rmSync(distDir, { recursive: true, force: true });
}
log("> vite build --mode phone");
if (run(process.execPath, [vite, "build", "--mode", "phone"]) !== 0) {
  fail("vite build failed. The APK was not built.");
}
const builtIndex = join(distDir, "index.html");
if (!existsSync(builtIndex)) {
  fail(`the web build produced no ${builtIndex}`);
}

// Confirm the values really are embedded, rather than trusting the build log. Both the
// host and the key must be present, or the app would install and then fail every request.
const assetDir = join(distDir, "assets");
const jsFiles = existsSync(assetDir)
  ? readdirSync(assetDir).filter((name) => name.endsWith(".js"))
  : [];
const bundleText = jsFiles.map((name) => readFileSync(join(assetDir, name), "utf8")).join("\n");
if (!bundleText.includes(supabaseHost)) {
  fail(
    `the built bundle does not contain the Supabase host "${supabaseHost}".\n` +
      "  The APK would install but could not reach the backend."
  );
}
// The anon key is a JWT: Vite may have inlined it verbatim, so the signature segment is
// the discriminating part to look for.
const keySignature = supabase.anonKey.split(".")[2];
if (keySignature && !bundleText.includes(keySignature)) {
  fail(
    "the built bundle does not contain the configured anon key.\n" +
      "  The APK would install but every authenticated request would be rejected."
  );
}
log(
  `verified    : bundle contains the Supabase host and the anon key across ${jsFiles.length} JS chunk(s)`
);

// ------------------------------------------------------------------------- Capacitor sync
// `capacitor.config.ts` needs no Supabase values (the app is served from https://localhost
// and calls Supabase over HTTPS, so no mixed-content relaxation is involved), but the sync
// still has to run so the web build is copied into the Android project.
log("\n--- Capacitor sync ---");
log("> capacitor sync android");
if (run(process.execPath, [capacitor, "sync", "android"]) !== 0) {
  fail("`cap sync android` failed. The APK was not built.");
}

// Read back what Capacitor actually wrote, rather than assuming it took effect.
const syncedConfigPath = join(androidRoot, "app", "src", "main", "assets", "capacitor.config.json");
const syncedPublicDir = join(androidRoot, "app", "src", "main", "assets", "public");
if (!existsSync(syncedConfigPath)) {
  fail(`\`cap sync\` did not write ${syncedConfigPath}`);
}
let syncedConfig;
try {
  syncedConfig = JSON.parse(readFileSync(syncedConfigPath, "utf8"));
} catch (error) {
  fail(`the synced ${syncedConfigPath} is not valid JSON: ${error.message}`);
}
if (syncedConfig.appId !== "com.jibonjori.app") {
  fail(`the synced configuration has appId "${syncedConfig.appId}", expected com.jibonjori.app`);
}
if (syncedConfig.android?.allowMixedContent === true) {
  fail(
    "the synced capacitor.config.json enables android.allowMixedContent.\n" +
      "  Nothing in this build needs plain HTTP, so relaxing mixed content would be an\n" +
      "  unnecessary weakening of the WebView's transport security."
  );
}
if (!existsSync(join(syncedPublicDir, "index.html"))) {
  fail(`\`cap sync\` did not copy the web build to ${syncedPublicDir}`);
}
log(`synced cfg  : appId=${syncedConfig.appId} allowMixedContent=${syncedConfig.android?.allowMixedContent === true}`);
log("synced web  : android/app/src/main/assets/public/index.html present");

// --------------------------------------------------------------------------- Gradle build
// The signing configuration lives in android/app/build.gradle. It reads
// android/keystore.properties when that file exists and leaves the release unsigned when
// it does not, so no keystore is ever created or committed by this script.
const releaseKeystoreProperties = join(androidRoot, "keystore.properties");
const hasReleaseKeystore = existsSync(releaseKeystoreProperties);
if (args.release) {
  log(
    hasReleaseKeystore
      ? "signing     : android/keystore.properties found - a SIGNED release APK will be produced"
      : "signing     : no android/keystore.properties - the release APK will be UNSIGNED and Android will refuse to install it"
  );
} else {
  log("signing     : debug key (manual testing only; not distributable)");
}

const gradleTask = args.release ? "assembleRelease" : "assembleDebug";
log(`\n--- Gradle ${gradleTask} ---`);
if (runGradle([gradleTask]) !== 0) {
  fail(
    "the Gradle build failed (see the output above).\n" +
      "  The APK was NOT produced. Do not treat a failure here as a successful build."
  );
}

// ------------------------------------------------------------------------------- reporting
const apkVariantDir = args.release ? "release" : "debug";
function resolveApkPath() {
  const candidates = args.release
    ? ["app-release-unsigned.apk", "app-release.apk"]
    : ["app-debug.apk"];
  for (const name of candidates) {
    const candidate = join(androidRoot, "app", "build", "outputs", "apk", apkVariantDir, name);
    if (existsSync(candidate)) return { candidate, name };
  }
  return {
    candidate: join(androidRoot, "app", "build", "outputs", "apk", apkVariantDir, candidates[0]),
    name: candidates[0],
  };
}
const resolved = resolveApkPath();
const apkPath = resolved.candidate;
if (!existsSync(apkPath)) {
  fail(`Gradle reported success but ${apkPath} does not exist.`);
}
const apkSize = statSync(apkPath).size;
if (apkSize === 0) {
  fail(`${apkPath} is empty.`);
}

// An APK is a zip archive, and zip stores entry names uncompressed, so the packaged files
// can be confirmed by searching the archive bytes. The JavaScript itself is deflated and is
// therefore not searched here; the uncompressed bundle was already checked before packaging.
const apkBytes = readFileSync(apkPath);
if (apkBytes.subarray(0, 4).toString("latin1") !== "PK\u0003\u0004") {
  fail(`${apkPath} is not a zip/APK archive.`);
}
const requiredEntries = [
  "AndroidManifest.xml",
  "assets/public/index.html",
  "assets/capacitor.config.json",
  "res/xml/network_security_config.xml",
];
const missingEntries = requiredEntries.filter(
  (entry) => !apkBytes.includes(Buffer.from(entry, "latin1"))
);
if (missingEntries.length > 0) {
  fail(`the APK is missing: ${missingEntries.join(", ")}`);
}
log(`verified    : APK contains ${requiredEntries.length} expected entries`);

log("\n=== APK ready ===");
log(`path        : ${apkPath}`);
log(`size        : ${apkSize} bytes (${(apkSize / (1024 * 1024)).toFixed(2)} MiB)`);
log("package id  : com.jibonjori.app");
log(`variant     : ${args.release ? "release" : "debug"}`);
log(`supabase url: ${supabase.url}`);
if (args.release && resolved.name === "app-release-unsigned.apk") {
  log("");
  log("WARNING: this is an UNSIGNED release APK. Android will refuse to install it.");
  log("  To produce a distributable, signed release:");
  log("    1. create a keystore (once, and keep it safe):");
  log("         keytool -genkeypair -v -keystore D:/keys/jibonjori-release.jks \\");
  log("           -keyalg RSA -keysize 2048 -validity 10000 -alias jibonjori");
  log("    2. copy frontend/android/keystore.properties.example to");
  log("       frontend/android/keystore.properties and fill it in (git-ignored);");
  log("    3. re-run `npm run build:android:release`.");
  log("  No keystore was created for you, and none is stored by this script.");
} else {
  log("\nInstall it with:");
  log(`  adb install -r "${apkPath}"`);
}
log("See frontend/PHONE_TESTING.md for the full manual test procedure.");
