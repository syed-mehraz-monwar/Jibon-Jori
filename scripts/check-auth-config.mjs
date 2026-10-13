#!/usr/bin/env node
//
// Auth-configuration gate: prove the repository's signup-confirmation email
// configuration actually matches what the client does.
//
// The client verifies signup with a TYPED 6-digit code:
//     getSupabase().auth.verifyOtp({ email, token, type: "signup" })
// That only works if the confirmation email carries `{{ .Token }}`. The Supabase
// default template carries only `{{ .ConfirmationURL }}`, so a missing or wrong
// template is a silent breakage: signup succeeds, the email arrives, and the member
// has nothing to type. Nothing else in the test suite would notice, because the
// client code is correct either way.
//
// So this gate asserts the whole chain, end to end, from the source of truth:
//   1. the client really calls verifyOtp with type "signup" and a token field;
//   2. config.toml sets enable_confirmations = true (the pending gate's first half);
//   3. config.toml sets otp_length to exactly 6 (Supabase allows 6-10);
//   4. config.toml declares [auth.email.template.confirmation] with a content_path;
//   5. that file exists and contains {{ .Token }};
//   6. it does NOT contain {{ .ConfirmationURL }}, which shares the single-use token
//      with the code and would let a link prefetcher burn the code;
//   7. it tells the member to enter the code in the app;
//   8. it contains no secret material.
//
// Usage:
//   node scripts/check-auth-config.mjs              # report and exit non-zero on problems
//   node scripts/check-auth-config.mjs --self-test  # also prove each check fires
//
import { readFileSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const CONFIG_PATH = resolve(ROOT, "supabase", "config.toml");
const AUTH_API_PATH = resolve(ROOT, "frontend", "src", "api", "auth.api.ts");

function read(path) {
  return readFileSync(path, "utf8");
}

/** Extracts a top-level key from a TOML section, unquoting string values. */
function sectionValue(toml, section, key) {
  const lines = toml.split(/\r?\n/);
  let inSection = false;
  for (const raw of lines) {
    const line = raw.replace(/#.*$/, "").trim();
    if (!line) continue;
    const header = line.match(/^\[(.+?)\]$/);
    if (header) {
      inSection = header[1].trim() === section;
      continue;
    }
    if (!inSection) continue;
    const match = line.match(new RegExp(`^${key}\\s*=\\s*(.+?)\\s*$`));
    if (!match) continue;
    const value = match[1].trim();
    // TOML string values may be quoted; strip the quotes so callers get the value.
    const quoted = value.match(/^(["'])(.*)\1$/);
    return quoted ? quoted[2] : value;
  }
  return null;
}

function isRealSection(toml, section) {
  return toml.split(/\r?\n/).some((line) => line.trim() === `[${section}]`);
}

const SECRET_PATTERNS = [
  { id: "sb_secret_", re: /sb_secret_[A-Za-z0-9_-]{8,}/ },
  { id: "provider key", re: /\bsk-[A-Za-z0-9_-]{20,}/ },
  { id: "Google API key", re: /AIza[0-9A-Za-z_-]{30,}/ },
  { id: "JWT", re: /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/ },
  { id: "Postgres URI with password", re: /postgres(?:ql)?:\/\/[^\s"'`]+:[^\s"'`@]+@/ },
  { id: "private key", re: /-----BEGIN [A-Z ]*PRIVATE KEY-----/ },
];

export function analyse({ config, authApi, templatePath, template }) {
  const problems = [];

  // 1. The client must use the OTP flow this gate is protecting.
  //
  // The type and the token are checked INSIDE the verifyOtp call's own argument
  // object, not merely somewhere in the file. `auth.api.ts` also contains
  // `auth.resend({ type: "signup", email })`, so a file-wide search would keep
  // passing even if verifyOtp's own `type` were changed - which is exactly the
  // breakage this gate exists to catch.
  const verifyCall = authApi.match(/auth\.verifyOtp\s*\(\s*\{[^}]*\}\s*\)/);
  if (!verifyCall) {
    problems.push("client: auth.api.ts no longer calls auth.verifyOtp({ ... })");
  } else {
    const call = verifyCall[0];
    if (!/\btoken\s*:/.test(call)) {
      problems.push("client: the verifyOtp call does not pass a token");
    }
    if (!/\btype\s*:\s*["']signup["']/.test(call)) {
      problems.push('client: the verifyOtp call does not use type: "signup"');
    }
  }

  // The resend call must request the SAME OTP type, otherwise it issues a code
  // that the verifyOtp call above will reject.
  const resendCall = authApi.match(/auth\.resend\s*\(\s*\{[^}]*\}\s*\)/);
  if (!resendCall) {
    problems.push("client: auth.api.ts no longer calls auth.resend({ ... }) for the signup code");
  } else if (!/\btype\s*:\s*["']signup["']/.test(resendCall[0])) {
    problems.push('client: the resend call does not use type: "signup" to match verifyOtp');
  }

  // 2-4. config.toml must describe that flow.
  const confirmations = sectionValue(config, "auth.email", "enable_confirmations");
  if (confirmations !== "true") {
    problems.push(`config: [auth.email] enable_confirmations is ${confirmations ?? "missing"}, expected true`);
  }

  const otpLength = sectionValue(config, "auth.email", "otp_length");
  if (otpLength === null) {
    problems.push("config: [auth.email] otp_length is missing");
  } else if (otpLength !== "6") {
    problems.push(`config: [auth.email] otp_length is ${otpLength}, expected exactly 6 to match the client`);
  }

  if (!isRealSection(config, "auth.email.template.confirmation")) {
    problems.push("config: [auth.email.template.confirmation] is not declared (or is still commented out)");
  }
  const contentPath = sectionValue(config, "auth.email.template.confirmation", "content_path");
  if (!contentPath) {
    problems.push("config: [auth.email.template.confirmation] has no content_path");
  }
  const subject = sectionValue(config, "auth.email.template.confirmation", "subject");
  if (!subject) {
    problems.push("config: [auth.email.template.confirmation] has no subject");
  }

  // 5-8. The template itself.
  if (!templatePath || !existsSync(templatePath)) {
    problems.push("template: the file named by content_path does not exist");
    return problems;
  }
  const html = template ?? read(templatePath);

  if (!/\{\{\s*\.Token\s*\}\}/.test(html)) {
    problems.push("template: {{ .Token }} is absent, so the email carries no code to type");
  }
  if (/\{\{\s*\.ConfirmationURL\s*\}\}/.test(html)) {
    problems.push(
      "template: {{ .ConfirmationURL }} is present; it shares the single-use token with {{ .Token }}, so a link prefetcher would consume the code",
    );
  }
  if (!/JibonJori/.test(html)) {
    problems.push("template: does not name the app, so the member is not told where to type the code");
  }
  if (!/(enter|type)/i.test(html)) {
    problems.push("template: does not instruct the member to enter the code in the app");
  }
  for (const { id, re } of SECRET_PATTERNS) {
    if (re.test(html)) problems.push(`template: contains what looks like a ${id}`);
    if (re.test(subject ?? "")) problems.push(`subject: contains what looks like a ${id}`);
  }

  return problems;
}

function loadInputs() {
  const config = read(CONFIG_PATH);
  const authApi = read(AUTH_API_PATH);
  const contentPath = sectionValue(config, "auth.email.template.confirmation", "content_path");
  const templatePath = contentPath
    ? resolve(ROOT, contentPath.replace(/^\.\//, "").replace(/^supabase\//, "supabase/"))
    : null;
  return { config, authApi, templatePath, template: null };
}

function report(problems) {
  if (problems.length === 0) {
    console.log("auth config: PROBLEMS=0");
    return;
  }
  console.log(`auth config: PROBLEMS=${problems.length}`);
  for (const p of problems) console.log(`  PROBLEM: ${p}`);
}

const inputs = loadInputs();
const problems = analyse(inputs);
report(problems);

let selfTestOk = true;
if (process.argv.includes("--self-test")) {
  console.log("");
  console.log("self-test (proves each check fires):");
  const template = read(inputs.templatePath);
  const mutations = [
    ["drop {{ .Token }} from the template", { ...inputs, template: template.replace(/\{\{\s*\.Token\s*\}\}/, "000000") }],
    ["leave {{ .ConfirmationURL }} in the template", { ...inputs, template: `${template}\n<a href="{{ .ConfirmationURL }}">Confirm</a>` }],
    ["turn confirmations off", { ...inputs, config: inputs.config.replace(/^enable_confirmations = true$/m, "enable_confirmations = false") }],
    ["change otp_length away from 6", { ...inputs, config: inputs.config.replace(/^otp_length = 6$/m, "otp_length = 8") }],
    ["comment the confirmation template back out", { ...inputs, config: inputs.config.replace(/^\[auth\.email\.template\.confirmation\]$/m, "# [auth.email.template.confirmation]") }],
    [
      "plant a secret in the template",
      // Built by concatenation so this file contains no literal that looks like a real
      // key; the repository security scanner would (correctly) flag one otherwise.
      { ...inputs, template: `${template}\n<!-- ${["sb", "secret", "SYNTHETICNOTACREDENTIAL"].join("_")} -->` },
    ],
    [
      "break the client's verifyOtp call",
      {
        ...inputs,
        authApi: inputs.authApi.replace(
          /(auth\.verifyOtp\s*\(\s*\{[^}]*?\btype\s*:\s*)["']signup["']/,
          '$1"email"',
        ),
      },
    ],
    [
      "make the resend call disagree with verifyOtp",
      {
        ...inputs,
        authApi: inputs.authApi.replace(
          /(auth\.resend\s*\(\s*\{[^}]*?\btype\s*:\s*)["']signup["']/,
          '$1"email"',
        ),
      },
    ],
  ];
  for (const [name, mutated] of mutations) {
    let detected;
    try {
      detected = analyse(mutated).length > 0;
    } catch (error) {
      detected = `threw: ${error.message}`;
    }
    const ok = detected === true;
    selfTestOk = selfTestOk && ok;
    console.log(`  ${ok ? "detected" : "MISSED  "} ${name}${ok ? "" : " <-- detector gap"}`);
  }
}

if (problems.length > 0 || !selfTestOk) {
  console.error("");
  console.error("AUTH CONFIG CHECK FAILED");
  process.exit(1);
}
console.log("");
console.log("AUTH CONFIG CHECK PASSED");
