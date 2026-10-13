// Scans a BUILT APK: decompresses its bundled JavaScript and assets, then looks for
// anything that must never ship. Prints findings only - never a secret value.
//
//   node test-support/scan-apk.mjs [path-to.apk] [--require]
//
// With no path it looks for the standard debug and release output. If no APK exists it
// reports SKIP and exits 0, because an APK can only be built once a real Supabase URL is
// configured; pass --require to make its absence a failure instead.
//
// This inspects the artifact a user would install, not the source, so it catches a value
// that reached the bundle through a dependency or a build step rather than through
// frontend/src.
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { inflateRawSync } from "node:zlib";
import { fileURLToPath } from "node:url";

const frontendRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const argv = process.argv.slice(2);
const requireApk = argv.includes("--require");
const explicit = argv.find((arg) => !arg.startsWith("--"));

const CANDIDATES = [
  explicit,
  join(frontendRoot, "android", "app", "build", "outputs", "apk", "debug", "app-debug.apk"),
  join(frontendRoot, "android", "app", "build", "outputs", "apk", "release", "app-release.apk"),
  join(frontendRoot, "android", "app", "build", "outputs", "apk", "release", "app-release-unsigned.apk"),
].filter(Boolean);

const APK = CANDIDATES.find((candidate) => existsSync(candidate));
if (!APK) {
  const message =
    "No APK found, so nothing was scanned.\n" +
    "  An APK is only produced once a real Supabase URL and anon key are configured:\n" +
    "    npm run build:android -- --supabase-url https://<ref>.supabase.co --anon-key <key>\n" +
    "  Then re-run: npm run test:apk";
  if (requireApk) {
    console.error(`[scan-apk] FAIL: ${message}`);
    process.exit(1);
  }
  console.log(`[scan-apk] SKIP: ${message}`);
  process.exit(0);
}

// --- minimal zip reader (APKs are zip archives) -------------------------------
function readZipEntries(buffer) {
  // Locate the End Of Central Directory record.
  let eocd = -1;
  for (let i = buffer.length - 22; i >= 0 && i >= buffer.length - 66000; i -= 1) {
    if (buffer.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error("not a zip archive (no end-of-central-directory record)");

  const count = buffer.readUInt16LE(eocd + 10);
  let offset = buffer.readUInt32LE(eocd + 16);
  const entries = [];

  for (let n = 0; n < count; n += 1) {
    if (buffer.readUInt32LE(offset) !== 0x02014b50) break;
    const method = buffer.readUInt16LE(offset + 10);
    const compressedSize = buffer.readUInt32LE(offset + 20);
    const uncompressedSize = buffer.readUInt32LE(offset + 24);
    const nameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const localOffset = buffer.readUInt32LE(offset + 42);
    const name = buffer.toString("latin1", offset + 46, offset + 46 + nameLength);
    entries.push({ name, method, compressedSize, uncompressedSize, localOffset });
    offset += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

function readEntryData(buffer, entry) {
  const lh = entry.localOffset;
  if (buffer.readUInt32LE(lh) !== 0x04034b50) throw new Error(`bad local header for ${entry.name}`);
  const nameLength = buffer.readUInt16LE(lh + 26);
  const extraLength = buffer.readUInt16LE(lh + 28);
  const start = lh + 30 + nameLength + extraLength;
  const raw = buffer.subarray(start, start + entry.compressedSize);
  if (entry.method === 0) return raw;
  if (entry.method === 8) return inflateRawSync(raw);
  throw new Error(`unsupported compression method ${entry.method} for ${entry.name}`);
}

const apk = readFileSync(APK);
const entries = readZipEntries(apk);

console.log(`apk        : ${APK}`);
console.log(`apk size   : ${apk.length} bytes`);
console.log(`zip entries: ${entries.length}`);

// --- gather the text a reverse engineer would read ----------------------------
const textParts = [];
const scanned = [];
for (const entry of entries) {
  const isTextish =
    /\.(js|json|html|css|xml|txt|map)$/i.test(entry.name) ||
    /assets\/public\//.test(entry.name);
  if (!isTextish) continue;
  try {
    const data = readEntryData(apk, entry);
    textParts.push(`\n/* ==== ${entry.name} ==== */\n${data.toString("utf8")}`);
    scanned.push(`${entry.name} (${data.length} B)`);
  } catch (error) {
    console.log(`  ! could not read ${entry.name}: ${error.message}`);
  }
}
console.log(`scanned    : ${scanned.length} text/asset entries`);
for (const name of scanned.slice(0, 12)) console.log(`             ${name}`);
if (scanned.length > 12) console.log(`             ... and ${scanned.length - 12} more`);

const haystack = textParts.join("\n");

// --- what must never appear ---------------------------------------------------
const FORBIDDEN = {
  "service_role literal": /service_role/,
  "Supabase secret key": /sb_secret_[A-Za-z0-9_-]{8,}/,
  "OpenAI-style key": /sk-[A-Za-z0-9]{20,}/,
  "Google API key": /AIza[0-9A-Za-z_-]{30,}/,
  "Postgres URI": /postgres(ql)?:\/\/[^\s"']+:[^\s"']+@/,
  "JWT secret name": /JWT_SECRET|OTP_HASH_SECRET/,
  "SMTP password": /SMTP_PASS|BREVO|sendinblue/i,
  "private key material": /BEGIN (RSA|EC|OPENSSH|PRIVATE) KEY/,
  "RFC1918 API origin": /https?:\/\/(?:10\.\d{1,3}|172\.(?:1[6-9]|2\d|3[01])|192\.168)\.\d{1,3}\.\d{1,3}/,
  "emulator alias origin": /https?:\/\/10\.0\.2\.2/,
  "loopback origin with port": /https?:\/\/(?:localhost|127\.0\.0\.1):\d+/,
  "Socket.IO endpoint": /socket\.io|\/socket\.io\/|io\.connect\(/,
  "Prisma client": /PrismaClient|@prisma\/client/,
  "Express server": /require\(['"]express['"]\)|from ['"]express['"]/,
  "old REST backend path": /\/api\/(?:auth|profiles|search|matches|reports|ratings|comments|media|notifications|chat|ml-prior)\b/,
  "old backend env var": /VITE_API_BASE_URL|VITE_SOCKET_URL|VITE_DEV_BACKEND_URL/,
};

/**
 * Loopback origins need care. `@supabase/auth-js` ships its own default
 * (`exports.GOTRUE_URL = 'http://localhost:9999'` in its constants module), so the string
 * is present in every bundle that imports supabase-js, whether or not this app ever used
 * it. Flagging that unconditionally would be a false positive; ignoring the pattern
 * entirely would be a blind spot. So every occurrence is inspected: the only permitted
 * one is that exact library default, and it must appear exactly once. Anything else - a
 * different port, a different host spelling, or a second occurrence - is a leak.
 */
const LIBRARY_LOOPBACK_DEFAULT = "http://localhost:9999";
const loopbackOccurrences = [...haystack.matchAll(/https?:\/\/(?:localhost|127\.0\.0\.1|\[::1\]):\d+/g)].map(
  (m) => m[0]
);

let problems = 0;
console.log("\n--- forbidden content ---");
for (const [label, pattern] of Object.entries(FORBIDDEN)) {
  // The loopback pattern is judged separately below, because a library ships one.
  if (label === "loopback origin with port") continue;
  const match = haystack.match(pattern);
  if (match) {
    problems += 1;
    console.log(`  LEAK  ${label}: found ${JSON.stringify(match[0].slice(0, 60))}`);
  } else {
    console.log(`  ok    ${label}`);
  }
}

const unexpectedLoopback = loopbackOccurrences.filter((o) => o !== LIBRARY_LOOPBACK_DEFAULT);
if (unexpectedLoopback.length > 0) {
  problems += 1;
  console.log(
    `  LEAK  loopback origin with port: ${unexpectedLoopback.length} occurrence(s) that are not the library default: ${[
      ...new Set(unexpectedLoopback),
    ].join(", ")}`
  );
} else if (loopbackOccurrences.length === 0) {
  console.log("  ok    loopback origin with port (none present at all)");
} else if (loopbackOccurrences.length > 1) {
  problems += 1;
  console.log(
    `  LEAK  loopback origin with port: the library default appears ${loopbackOccurrences.length} times, expected exactly once`
  );
} else {
  console.log(
    "  ok    loopback origin with port: only the @supabase/auth-js default constant (unreachable; see note)"
  );
}

// --- what SHOULD be present, and only these -----------------------------------
console.log("\n--- expected content ---");
const origins = [...haystack.matchAll(/https?:\/\/[a-z0-9.-]+\.[a-z]{2,}/gi)]
  .map((m) => m[0].toLowerCase())
  .filter((o) => !o.includes("w3.org") && !o.includes("schema") && !o.includes("xml"))
  .reduce((acc, o) => (acc[o] = (acc[o] ?? 0) + 1, acc), {});
const uniqueOrigins = Object.keys(origins).sort();
console.log(`  distinct absolute origins referenced: ${uniqueOrigins.length}`);
for (const origin of uniqueOrigins) console.log(`    ${origin}  x${origins[origin]}`);

// The Supabase host baked in at build time. It is not known here, so it is discovered:
// any `https://<ref>.supabase.co` origin found in the bundle is the configured project.
const supabaseHosts = uniqueOrigins.filter((o) => /\.supabase\.(co|in)$/.test(o));
if (supabaseHosts.length === 1) {
  console.log(`  ok    exactly one Supabase origin is embedded: ${supabaseHosts[0]}`);
} else if (supabaseHosts.length === 0) {
  problems += 1;
  console.log(
    "  LEAK  no Supabase origin is embedded: the app would install and then fail every request"
  );
} else {
  problems += 1;
  console.log(
    `  LEAK  ${supabaseHosts.length} Supabase origins are embedded, expected one: ${supabaseHosts.join(", ")}`
  );
}

console.log(`\nresult     : ${problems === 0 ? "CLEAN (no forbidden content)" : `${problems} PROBLEM(S)`}`);
if (loopbackOccurrences.length === 1 && problems === 0) {
  console.log(
    "\nnote       : the one loopback string is a constant inside @supabase/auth-js\n" +
      "             (dist/main/lib/constants.js: exports.GOTRUE_URL = 'http://localhost:9999').\n" +
      "             It is not this app's configuration. It is unreachable because\n" +
      "             lib/supabase.ts refuses to construct a client unless both\n" +
      "             VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY are set, and the build\n" +
      "             script refuses to build without them, so the client always receives an\n" +
      "             explicit URL and never falls back to this default."
  );
}
process.exit(problems === 0 ? 0 : 1);
