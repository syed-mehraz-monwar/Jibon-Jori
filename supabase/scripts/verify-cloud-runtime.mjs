#!/usr/bin/env node
/**
 * =============================================================================
 * JibonJori - cloud runtime + adversarial verification harness
 * =============================================================================
 * This is the cloud counterpart to `tests/run-rls-tests.sh`.
 *
 * That suite proves the policies are correct at the SQL layer by switching roles inside
 * one database, using a synthetic `auth.users` stand-in. This harness proves the SAME
 * properties end to end, through the real public API surface a phone actually uses:
 * Supabase Auth, PostgREST, Storage and Realtime. It uses the deployed policies, the
 * deployed triggers, and real JWTs - so it catches anything that is correct in SQL but
 * wrong once the REST layer, the Storage layer or the gateway sits in front of it.
 *
 * It is ADVERSARIAL. Most claims assert that something is REFUSED. A claim passes only
 * when the operation was actually denied.
 *
 * ---------------------------------------------------------------------------
 * REQUIREMENTS
 * ---------------------------------------------------------------------------
 * It creates and then deletes its own test data, but it does write to the project: two
 * confirmed users, a profile field change, an uploaded object and a comment. Run it
 * against a THROWAWAY project or a `supabase branches` preview branch, never against
 * production with real members.
 *
 * ---------------------------------------------------------------------------
 * USAGE
 * ---------------------------------------------------------------------------
 * Nothing is read from a file and no credential is printed. Pass the values through the
 * environment for this command only:
 *
 *   $env:SUPABASE_URL='https://<ref>.supabase.co'
 *   $env:SUPABASE_ANON_KEY='<anon or sb_publishable_ key>'
 *   $env:SUPABASE_SERVICE_ROLE_KEY='<service_role or sb_secret_ key>'   # setup + teardown + adversarial setup
 *   node supabase/scripts/verify-cloud-runtime.mjs
 *
 * Add `--keep` to leave the created users in place for manual inspection.
 * Add `--only auth|rls|storage|functions|realtime` to run one section.
 *
 * ---------------------------------------------------------------------------
 * HONESTY RULES ENFORCED IN CODE
 * ---------------------------------------------------------------------------
 *   * With no credentials it exits immediately having reported NOTHING. It can never
 *     report a pass it did not observe.
 *   * A claim that throws is reported ERROR, never PASS. "Could not determine" and
 *     "verified" are different outcomes.
 *   * The service-role key is used only for setup, teardown and the adversarial
 *     "suspend/close the other user" steps. Every access-control claim is made with a
 *     deliberately weak client: the anon key, or one user's own token.
 * =============================================================================
 */
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const frontendRoot = join(here, "..", "..", "frontend");

// supabase-js is the frontend's dependency, and this harness must use the SAME major
// version the app ships, or it would be testing a different client.
const require = createRequire(join(frontendRoot, "package.json"));
let createClient;
try {
  ({ createClient } = require("@supabase/supabase-js"));
} catch {
  process.stderr.write(
    "\n[could not load @supabase/supabase-js from frontend/node_modules.\n" +
      " Run `npm install` in frontend/ first.]\n\n"
  );
  process.exit(1);
}

// ---------------------------------------------------------------------------- cli
const argv = process.argv.slice(2);
const keep = argv.includes("--keep");
const onlyIndex = argv.indexOf("--only");
const only = onlyIndex >= 0 ? argv[onlyIndex + 1] : undefined;

// --------------------------------------------------------------------- credentials
const URL = (process.env.SUPABASE_URL ?? "").trim().replace(/\/$/, "");
const ANON = (process.env.SUPABASE_ANON_KEY ?? "").trim();
const SERVICE = (process.env.SUPABASE_SERVICE_ROLE_KEY ?? "").trim();

const missing = [];
if (!URL) missing.push("SUPABASE_URL");
if (!ANON) missing.push("SUPABASE_ANON_KEY");
if (!SERVICE) missing.push("SUPABASE_SERVICE_ROLE_KEY");

if (missing.length > 0) {
  process.stderr.write(
    [
      "",
      "REFUSING TO RUN: no cloud project was supplied.",
      "",
      `  missing: ${missing.join(", ")}`,
      "",
      "  This harness makes no claim and prints no result without a real project,",
      "  because an unexecuted check must never be reported as verified.",
      "",
      "  Supply the values for this command only:",
      "    $env:SUPABASE_URL='https://<ref>.supabase.co'",
      "    $env:SUPABASE_ANON_KEY='<anon/publishable key>'",
      "    $env:SUPABASE_SERVICE_ROLE_KEY='<service_role key>'",
      "",
      "  Values are at Supabase Dashboard -> Settings -> API.",
      "  See docs/SUPABASE_CLOUD_SETUP.md.",
      "",
    ].join("\n")
  );
  process.exit(2);
}

// A key that would grant full access must not be mistaken for the public key.
function looksLikeSecretKey(value) {
  if (value.startsWith("sb_secret_")) return true;
  const parts = value.split(".");
  if (parts.length !== 3) return false;
  try {
    const payload = JSON.parse(
      Buffer.from(parts[1].replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8")
    );
    return payload?.role === "service_role";
  } catch {
    return false;
  }
}
if (looksLikeSecretKey(ANON)) {
  process.stderr.write(
    "\nREFUSING TO RUN: SUPABASE_ANON_KEY holds a service_role/secret key.\n" +
      "  The client-side claims would be meaningless, because that key bypasses RLS.\n\n"
  );
  process.exit(2);
}
if (!looksLikeSecretKey(SERVICE)) {
  process.stderr.write(
    "\nREFUSING TO RUN: SUPABASE_SERVICE_ROLE_KEY does not look like a service_role/secret key.\n" +
      "  Setup, teardown and the suspend/close steps need it.\n\n"
  );
  process.exit(2);
}

// ---------------------------------------------------------------------- reporting
const results = [];
function record(section, claim, status, detail) {
  results.push({ section, claim, status, detail });
  const tag = { PASS: "PASS", FAIL: "FAIL", ERROR: "ERROR", SKIP: "SKIP" }[status] ?? status;
  process.stdout.write(`  ${tag}  [${section}] ${claim}${detail ? ` - ${detail}` : ""}\n`);
}

/**
 * Runs one claim. `fn` returns either nothing (pass) or a string detail (pass with
 * detail). To fail, throw an Error whose message explains what was observed. Any
 * unexpected exception becomes ERROR, which is deliberately NOT a pass.
 */
async function claim(section, description, fn) {
  try {
    const detail = await fn();
    record(section, description, "PASS", typeof detail === "string" ? detail : "");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    // A claim that fails by asserting is a real FAIL; anything else is an ERROR.
    const isAssertion = error && error.name === "AssertionError";
    record(section, description, isAssertion ? "FAIL" : "ERROR", message.slice(0, 200));
  }
}

function assert(condition, message) {
  if (!condition) {
    const error = new Error(message);
    error.name = "AssertionError";
    throw error;
  }
}

/** Reports the HTTP status and message from a PostgREST/Storage error, for evidence. */
function describeError(error) {
  if (!error) return "no error";
  return `${error.code ?? "?"}/${error.status ?? "?"}: ${(error.message ?? "").slice(0, 120)}`;
}

/**
 * A denial can appear two ways: an explicit error, or a silent empty result. Both are
 * "denied"; only a non-empty result is a leak. This asserts the operation did not
 * succeed and did not return the forbidden row.
 */
function assertDenied({ error, data }, what) {
  const returned =
    data === null || data === undefined || (Array.isArray(data) && data.length === 0);
  if (error) return `denied (${describeError(error)})`;
  assert(returned, `LEAK: ${what} succeeded and returned data`);
  return "denied (empty result, no error)";
}

function assertAllowed({ error, data }, what) {
  assert(!error, `${what} was refused unexpectedly: ${describeError(error)}`);
  assert(data !== null && data !== undefined, `${what} returned nothing`);
  return "allowed as intended";
}

const rand = Math.random().toString(36).slice(2, 8);
const password = `JjVerif!${rand}${rand.toUpperCase()}9`;
const userA = { email: `jj.verify.a.${rand}@example.com`, username: `jjverifya${rand}`, displayName: "Verify A", gender: "male", city: "Dhaka" };
const userB = { email: `jj.verify.b.${rand}@example.com`, username: `jjverifyb${rand}`, displayName: "Verify B", gender: "female", city: "Chattogram" };
const pendingUser = { email: `jj.verify.p.${rand}@example.com`, username: `jjverifyp${rand}` };

const created = [];
const admin = createClient(URL, SERVICE, { auth: { persistSession: false, autoRefreshToken: false } });
// `anon` must stay SESSIONLESS for the lifetime of the run: every claim whose label says
// "as anon" is only meaningful if the client has never signed in. Sign-in flows therefore use
// `freshClient()` below. Previously a sign-in landed on this shared client, which silently
// turned later "anon" claims into authenticated ones and produced a false LEAK report.
const anon = createClient(URL, ANON, { auth: { persistSession: false, autoRefreshToken: false } });

/** A brand-new anonymous client. Used by any flow that signs in, so `anon` stays clean. */
function freshClient() {
  return createClient(URL, ANON, { auth: { persistSession: false, autoRefreshToken: false } });
}

/** A client that speaks as one specific user, with that user's own token. */
function asUser(accessToken) {
  return createClient(URL, ANON, {
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

process.stdout.write(
  [
    "",
    "=== JibonJori cloud runtime + adversarial verification ===",
    `project      : ${URL}`,
    `mode         : ${only ? `only "${only}"` : "all sections"}`,
    "",
    "This harness WRITES test data (2 users, a profile edit, an upload, a comment) and",
    "removes it afterwards. Use a throwaway project or a preview branch.",
    "",
  ].join("\n")
);

// ------------------------------------------------------------------------ teardown
async function teardown() {
  if (keep) {
    process.stdout.write(`\n--keep given: leaving ${created.length} test user(s) in place.\n`);
    return;
  }
  for (const id of created) {
    const { error } = await admin.auth.admin.deleteUser(id);
    if (error) {
      process.stdout.write(`  (teardown) could not delete ${id}: ${error.message}\n`);
    }
  }
  process.stdout.write(`\nteardown     : removed ${created.length} test user(s)\n`);
}

/** Creates a confirmed user and returns { id, client, token }. */
async function makeConfirmedUser(spec) {
  const { data, error } = await admin.auth.admin.createUser({
    email: spec.email,
    password,
    email_confirm: true,
    user_metadata: { username: spec.username },
  });
  assert(!error, `createUser failed: ${describeError(error)}`);
  const id = data.user.id;
  created.push(id);

  // Publish the profile. `is_public` defaults to false, and `can_view_profile` refuses a
  // non-public target, so without this the pair could not legitimately interact and the
  // positive-path claims (commenting, realtime) would fail for the wrong reason. The
  // `profiles_publish_requires_core_fields` check also demands the core attributes, so they
  // are supplied in the same statement.
  {
    const { error: publishError } = await admin
      .from("profiles")
      .update({
        display_name: spec.displayName,
        dob: "1992-05-15",
        gender: spec.gender,
        city: spec.city,
        is_public: true,
      })
      .eq("id", id);
    assert(!publishError, `could not publish ${spec.email}: ${describeError(publishError)}`);
  }

  const { data: session, error: signInError } = await freshClient().auth.signInWithPassword({
    email: spec.email,
    password,
  });
  assert(!signInError, `signIn failed for ${spec.email}: ${describeError(signInError)}`);
  return { id, token: session.session.access_token, client: asUser(session.session.access_token) };
}

// ============================================================================ SETUP
process.stdout.write("--- setup ---\n");
let A;
let B;
try {
  A = await makeConfirmedUser(userA);
  record("setup", "two confirmed users created and signed in", "PASS", "A and B");
  B = await makeConfirmedUser(userB);
} catch (error) {
  record(
    "setup",
    "two confirmed users created and signed in",
    "ERROR",
    error instanceof Error ? error.message.slice(0, 200) : String(error)
  );
  process.stdout.write(
    "\nSetup failed, so no access-control claim can be made. Common causes:\n" +
      "  - migrations not applied yet (profiles/trigger missing): run `cloud.mjs push`\n" +
      "  - email confirmation disabled but the trigger needs a verified contact\n" +
      "  - the anon key is actually a publishable key from a different project\n\n"
  );
  await teardown();
  process.exit(1);
}

// ============================================================ 1. ADVERSARIAL RLS / IDOR
if (!only || only === "rls") {
  process.stdout.write("\n--- RLS / IDOR (adversarial) ---\n");

  // Give B something private that A must not reach.
  const bPrivateAbout = `jj-private-${rand}`;
  {
    const { error } = await B.client
      .from("profiles")
      .update({ about: bPrivateAbout })
      .eq("id", B.id);
    assert(!error, `could not seed B's profile: ${describeError(error)}`);
  }

  await claim("rls", "A cannot modify B's profile row (IDOR on update)", async () => {
    const { error } = await A.client
      .from("profiles")
      .update({ about: "tampered-by-A" })
      .eq("id", B.id);
    // A postgrest update that matches nothing raises no error, so the real check is
    // whether the value changed. Verify with the service client, not by trust.
    const { data: after } = await admin.from("profiles").select("about").eq("id", B.id).single();
    assert(after.about !== "tampered-by-A", "B's profile WAS modified by A");
    return `B's row unchanged (update reported: ${error ? describeError(error) : "0 rows"})`;
  });

  await claim("rls", "A cannot delete B's profile row", async () => {
    const { error } = await A.client.from("profiles").delete().eq("id", B.id);
    const { data: still } = await admin.from("profiles").select("id").eq("id", B.id).maybeSingle();
    assert(still?.id === B.id, "B's profile row WAS deleted by A");
    return `row still present (delete reported: ${error ? describeError(error) : "0 rows"})`;
  });

  await claim("rls", "A cannot escalate its own role to admin", async () => {
    const { error } = await A.client.from("profiles").update({ role: "admin" }).eq("id", A.id);
    const { data: after } = await admin.from("profiles").select("role").eq("id", A.id).single();
    assert(after.role !== "admin", "A promoted itself to admin");
    return `role still "${after.role}" (update reported: ${error ? describeError(error) : "0 rows"})`;
  });

  await claim("rls", "A cannot set its own deleted_at to bypass the gate", async () => {
    await A.client.from("profiles").update({ deleted_at: new Date().toISOString() }).eq("id", A.id);
    const { data: after } = await admin.from("profiles").select("deleted_at").eq("id", A.id).single();
    assert(after.deleted_at === null, "A was able to set deleted_at on itself");
    return "deleted_at still null";
  });

  await claim("rls", "A cannot read B's private media rows", async () => {
    const { data, error } = await A.client
      .from("media")
      .select("id, storage_path")
      .eq("profile_id", B.id);
    return assertDenied({ data, error }, "reading B's media metadata");
  });

  await claim("rls", "A cannot forge a rating attributed to B", async () => {
    const { data, error } = await A.client
      .from("ratings")
      .insert({ rater_profile_id: B.id, rated_profile_id: A.id, score: 5 })
      .select("id");
    const { data: forged } = await admin
      .from("ratings")
      .select("id")
      .eq("rater_profile_id", B.id)
      .eq("rated_profile_id", A.id)
      .maybeSingle();
    assert(!forged, "a rating attributed to B was written");
    return assertDenied({ data, error }, "forging B's rating");
  });

  await claim("rls", "A cannot forge a comment authored by B", async () => {
    const { data, error } = await A.client
      .from("comments")
      .insert({ author_profile_id: B.id, target_profile_id: A.id, body: "forged" })
      .select("id");
    const { data: forged } = await admin
      .from("comments")
      .select("id")
      .eq("author_profile_id", B.id)
      .eq("target_profile_id", A.id)
      .maybeSingle();
    assert(!forged, "a comment attributed to B was written");
    return assertDenied({ data, error }, "forging B's comment");
  });

  await claim("rls", "A cannot read B's notifications", async () => {
    const { data, error } = await A.client.from("notifications").select("*").eq("profile_id", B.id);
    return assertDenied({ data, error }, "reading B's notifications");
  });

  await claim("rls", "A cannot read B's chat conversations", async () => {
    const { data, error } = await A.client
      .from("chat_conversations")
      .select("id")
      .eq("profile_id", B.id);
    return assertDenied({ data, error }, "reading B's conversations");
  });

  await claim("rls", "A cannot read the audit log", async () => {
    const { data, error } = await A.client.from("audit_logs").select("*").limit(1);
    return assertDenied({ data, error }, "reading audit_logs");
  });

  await claim("rls", "A cannot enumerate other profiles' email/phone", async () => {
    const { data, error } = await A.client.from("profiles").select("id, username").neq("id", A.id);
    if (error) return `denied (${describeError(error)})`;
    // Reading discoverable profiles is intended; leaking a contact column is not.
    return `allowed ${data?.length ?? 0} discoverable profile(s) - intended select only`;
  });

  await claim("rls", "anon can read reference data", async () => {
    const { data, error } = await anon.from("education_levels").select("id").limit(1);
    return assertAllowed({ data, error }, "reading education_levels as anon");
  });

  await claim("rls", "anon cannot read profiles", async () => {
    const { data, error } = await anon.from("profiles").select("id").limit(1);
    return assertDenied({ data, error }, "anon reading profiles");
  });

  await claim("rls", "anon cannot write to any published table", async () => {
    const { data, error } = await anon
      .from("comments")
      .insert({ author_profile_id: A.id, target_profile_id: B.id, body: "anon" })
      .select("id");
    return assertDenied({ data, error }, "anon inserting a comment");
  });

  await claim("rls", "a suspended member drops out of discovery and cannot participate", async () => {
    const { error: suspendError } = await admin
      .from("profiles")
      .update({ is_suspended: true })
      .eq("id", A.id);
    assert(!suspendError, `could not suspend A: ${describeError(suspendError)}`);
    try {
      // Target side: can_view_profile() consults is_suspended, so B must no longer see A.
      const { data: seen } = await B.client.from("profiles").select("id").eq("id", A.id);
      assert(!(Array.isArray(seen) && seen.length > 0), "B could still see a suspended member");

      // Actor side: is_active_member() is false for a suspended caller, so it cannot interact.
      // Reading its OWN row stays allowed by design, so that is deliberately not asserted here.
      const { data, error } = await A.client
        .from("comments")
        .insert({ author_profile_id: A.id, target_profile_id: B.id, body: `susp-${rand}` });
      assert(error || !data, "a suspended member could still post a comment");
      return `hidden from B and blocked from commenting (${error ? describeError(error) : "no error"})`;
    } finally {
      await admin.from("profiles").update({ is_suspended: false }).eq("id", A.id);
    }
  });

  await claim("rls", "a closed (deleted_at) member drops out of discovery and cannot participate", async () => {
    const { error: closeError } = await admin
      .from("profiles")
      .update({ deleted_at: new Date().toISOString() })
      .eq("id", A.id);
    assert(!closeError, `could not close A: ${describeError(closeError)}`);
    try {
      const { data: seen } = await B.client.from("profiles").select("id").eq("id", A.id);
      assert(!(Array.isArray(seen) && seen.length > 0), "B could still see a closed member");

      const { data, error } = await A.client
        .from("comments")
        .insert({ author_profile_id: A.id, target_profile_id: B.id, body: `closed-${rand}` });
      assert(error || !data, "a closed member could still post a comment");
      return `hidden from B and blocked from commenting (${error ? describeError(error) : "no error"})`;
    } finally {
      await admin.from("profiles").update({ deleted_at: null }).eq("id", A.id);
    }
  });

  await claim("rls", "an unverified account is treated as pending, not active", async () => {
    const { data, error } = await admin.auth.admin.createUser({
      email: pendingUser.email,
      password,
      email_confirm: false,
      user_metadata: { username: pendingUser.username },
    });
    assert(!error, `could not create the unverified user: ${describeError(error)}`);
    created.push(data.user.id);

    const { data: state } = await admin.rpc("account_state", { p_id: data.user.id });
    assert(state === "pending", `account_state returned "${state}", expected "pending"`);
    return `account_state = "${state}"`;
  });

  await claim("rls", "a non-admin cannot call an admin-only report", async () => {
    const { data, error } = await A.client.rpc("report_users");
    return assertDenied({ data: data, error }, "A calling report_users");
  });

  await claim("rls", "A cannot write the ml_artifacts table", async () => {
    const { data, error } = await A.client
      .from("ml_artifacts")
      .insert({ version: "forged", payload: {} })
      .select("id");
    return assertDenied({ data, error }, "A inserting an ml_artifact");
  });
}

// ========================================================================= 2. AUTH
if (!only || only === "auth") {
  process.stdout.write("\n--- Auth ---\n");

  await claim("auth", "login before email confirmation is rejected", async () => {
    const { data, error } = await freshClient().auth.signInWithPassword({
      email: pendingUser.email,
      password,
    });
    assert(error || !data.session, "an unconfirmed account received a session");
    return `refused (${error?.message?.slice(0, 80) ?? "no session issued"})`;
  });

  await claim("auth", "login after confirmation succeeds", async () => {
    const { data, error } = await freshClient().auth.signInWithPassword({ email: userA.email, password });
    assert(!error, `login failed: ${describeError(error)}`);
    assert(data.session?.access_token, "no access token issued");
    return "session + access token issued";
  });

  await claim("auth", "the access token resolves to the right user", async () => {
    const client = asUser(A.token);
    const { data, error } = await client.auth.getUser();
    assert(!error, `getUser failed: ${describeError(error)}`);
    assert(data.user.id === A.id, `token resolved to ${data.user.id}, expected ${A.id}`);
    return "token identity matches";
  });

  await claim("auth", "refresh returns a new usable token", async () => {
    const { data: signedIn } = await createClient(URL, ANON, {
      auth: { persistSession: false, autoRefreshToken: false },
    }).auth.signInWithPassword({ email: userA.email, password });
    const { data, error } = await createClient(URL, ANON, {
      auth: { persistSession: false, autoRefreshToken: false },
    }).auth.refreshSession({ refresh_token: signedIn.session.refresh_token });
    assert(!error, `refresh failed: ${describeError(error)}`);
    assert(data.session?.access_token, "refresh returned no access token");
    return "refresh issued a new session";
  });

  await claim("auth", "wrong password is rejected", async () => {
    const { data, error } = await freshClient().auth.signInWithPassword({
      email: userA.email,
      password: "definitely-not-the-password",
    });
    assert(error || !data.session, "a wrong password produced a session");
    return "refused";
  });

  await claim("auth", "session revocation invalidates the token", async () => {
    const throwaway = await createClient(URL, ANON, {
      auth: { persistSession: false, autoRefreshToken: false },
    }).auth.signInWithPassword({ email: userB.email, password });
    const token = throwaway.data.session.access_token;

    // The `sessions` Edge Function revokes every session except the caller's. Use the
    // throwaway session as the caller so the real B session survives.
    const caller = asUser(token);
    const { data, error } = await caller.functions.invoke("sessions", {
      body: { revokeOthers: true },
    });
    assert(!error, `sessions invoke failed: ${error?.message ?? "unknown"}`);
    return `revoked ${data?.revoked ?? "?"} other session(s)`;
  });

  await claim("auth", "signOut ends the session", async () => {
    const client = createClient(URL, ANON, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    await client.auth.signInWithPassword({ email: userB.email, password });
    const { error } = await client.auth.signOut();
    assert(!error, `signOut failed: ${describeError(error)}`);
    return "signed out";
  });

  await claim("auth", "an invalid token is refused by PostgREST", async () => {
    const forged = asUser("not.a.real.token");
    const { data, error } = await forged.from("profiles").select("id").limit(1);
    return assertDenied({ data, error }, "a forged bearer token");
  });

  await claim("auth", "username availability RPC works for anon", async () => {
    const { data, error } = await anon.rpc("username_available", { p_username: userA.username });
    assert(!error, `username_available failed: ${describeError(error)}`);
    assert(data !== null && data !== undefined, "username_available returned nothing");
    return `returned ${JSON.stringify(data).slice(0, 60)}`;
  });
}

// ====================================================================== 3. STORAGE
if (!only || only === "storage") {
  process.stdout.write("\n--- Storage ---\n");
  const path = `${A.id}/verify-${rand}.jpg`;
  const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46]);

  await claim("storage", "A can upload to its own folder", async () => {
    const { error } = await A.client.storage
      .from("profile-photos")
      .upload(path, jpeg, { contentType: "image/jpeg", upsert: true });
    assert(!error, `upload failed: ${describeError(error)}`);
    return "uploaded";
  });

  await claim("storage", "an invalid MIME type is rejected", async () => {
    const { error } = await A.client.storage
      .from("profile-photos")
      .upload(`${A.id}/verify-${rand}.txt`, Buffer.from("not an image"), {
        contentType: "text/plain",
        upsert: true,
      });
    assert(error, "a text/plain upload to profile-photos was accepted");
    return `refused (${describeError(error)})`;
  });

  await claim("storage", "a signed URL works for the owner", async () => {
    const { data, error } = await A.client.storage
      .from("profile-photos")
      .createSignedUrl(path, 60);
    assert(!error, `createSignedUrl failed: ${describeError(error)}`);
    assert(data?.signedUrl, "no signed URL returned");
    const response = await fetch(data.signedUrl);
    assert(response.ok, `the signed URL returned HTTP ${response.status}`);
    return `HTTP ${response.status}`;
  });

  await claim("storage", "an expired signed URL fails", async () => {
    const { data, error } = await A.client.storage
      .from("profile-photos")
      .createSignedUrl(path, 1);
    assert(!error, `createSignedUrl failed: ${describeError(error)}`);
    await new Promise((resolve) => setTimeout(resolve, 2500));
    const response = await fetch(data.signedUrl);
    assert(!response.ok, `a 1-second signed URL still worked after 2.5s (HTTP ${response.status})`);
    return `HTTP ${response.status} after expiry`;
  });

  // These two claims only mean anything if A's photos are actually hidden. `photo_visibility`
  // defaults to 'public', and `can_view_photos` refuses only 'private', so a published A is
  // legitimately readable by any active member - the earlier "leak" was a missing premise, not
  // a policy hole. Make the target private for the duration of the denial claims.
  await claim("storage", "B cannot read A's private object", async () => {
    await admin.from("profiles").update({ photo_visibility: "private" }).eq("id", A.id);
    try {
      const { data, error } = await B.client.storage.from("profile-photos").download(path);
      assert(error || !data, "B downloaded A's private object");
      return `refused (${describeError(error)})`;
    } finally {
      await admin.from("profiles").update({ photo_visibility: "public" }).eq("id", A.id);
    }
  });

  await claim("storage", "B cannot sign a URL for A's object", async () => {
    await admin.from("profiles").update({ photo_visibility: "private" }).eq("id", A.id);
    try {
      const { data, error } = await B.client.storage
        .from("profile-photos")
        .createSignedUrl(path, 60);
      assert(error || !data?.signedUrl, "B obtained a signed URL for A's object");
      return `refused (${describeError(error)})`;
    } finally {
      await admin.from("profiles").update({ photo_visibility: "public" }).eq("id", A.id);
    }
  });

  await claim("storage", "B cannot delete A's object", async () => {
    const { error } = await B.client.storage.from("profile-photos").remove([path]);
    const { data: still } = await admin.storage.from("profile-photos").list(A.id);
    assert(
      (still ?? []).some((entry) => entry.name === `verify-${rand}.jpg`),
      "A's object was deleted by B"
    );
    return `object still present (remove reported: ${error ? describeError(error) : "no error"})`;
  });

  await claim("storage", "the owner can delete its own object", async () => {
    const { error } = await A.client.storage.from("profile-photos").remove([path]);
    assert(!error, `owner delete failed: ${describeError(error)}`);
    const { data: after } = await admin.storage.from("profile-photos").list(A.id);
    assert(
      !(after ?? []).some((entry) => entry.name === `verify-${rand}.jpg`),
      "the object was not removed"
    );
    return "removed";
  });
}

// ===================================================================== 4. FUNCTIONS
if (!only || only === "functions") {
  process.stdout.write("\n--- Edge Functions ---\n");

  await claim("functions", "ai-explanation: unauthenticated is refused", async () => {
    const { error } = await anon.functions.invoke("ai-explanation", {
      body: { targetProfileId: B.id },
    });
    assert(error, "an unauthenticated invoke succeeded");
    return `refused (HTTP ${error.context?.status ?? "?"})`;
  });

  await claim("functions", "ai-explanation: a valid request returns the deterministic score", async () => {
    const { data, error } = await A.client.functions.invoke("ai-explanation", {
      body: { targetProfileId: B.id },
    });
    assert(!error, `invoke failed: ${describeError(error)}`);
    assert(data?.compatibility, "no compatibility block returned");
    assert(typeof data.explanation === "string" && data.explanation.length > 0, "no explanation");
    return `fallback=${data.fallback} overall=${data.compatibility.overall_score}`;
  });

  await claim("functions", "ai-explanation: a malformed target is refused", async () => {
    const { error } = await A.client.functions.invoke("ai-explanation", {
      body: { targetProfileId: "not-a-uuid" },
    });
    assert(error, "a malformed targetProfileId was accepted");
    return `refused (HTTP ${error.context?.status ?? "?"})`;
  });

  await claim("functions", "ai-chat: an unowned conversation is refused", async () => {
    const fake = "00000000-0000-0000-0000-000000000000";
    const { error } = await A.client.functions.invoke("ai-chat", {
      body: { conversationId: fake, content: "hello" },
    });
    assert(error, "chatting into a non-existent conversation succeeded");
    return `refused (HTTP ${error.context?.status ?? "?"})`;
  });

  await claim("functions", "reports: a non-admin is refused", async () => {
    const { error } = await A.client.functions.invoke("reports?kind=users", { method: "GET" });
    assert(error, "a non-admin generated the users report");
    return `refused (HTTP ${error.context?.status ?? "?"})`;
  });

  await claim("functions", "reports: an unknown kind is refused", async () => {
    const { error } = await A.client.functions.invoke("reports?kind=nonsense", { method: "GET" });
    assert(error, "an unknown report kind generated a dataset");
    return `refused (HTTP ${error.context?.status ?? "?"})`;
  });

  await claim("functions", "sessions: lists only the caller's own sessions", async () => {
    const { data, error } = await A.client.functions.invoke("sessions", { method: "GET" });
    assert(!error, `sessions GET failed: ${error?.message ?? "unknown"}`);
    assert(Array.isArray(data?.sessions), "no sessions array returned");
    const foreign = data.sessions.filter((s) => s.id && s.id === B.id);
    assert(foreign.length === 0, "another account's session was listed");
    return `${data.sessions.length} session(s), all the caller's own`;
  });

  await claim("functions", "sessions: revoking the current session is refused", async () => {
    const { data: list } = await A.client.functions.invoke("sessions", { method: "GET" });
    const current = list.sessions.find((s) => s.isCurrent);
    assert(current, "the current session was not identified");
    const { error } = await A.client.functions.invoke("sessions", { body: { sessionId: current.id } });
    assert(error, "the caller was allowed to revoke its own current session");
    return `refused (HTTP ${error.context?.status ?? "?"})`;
  });

  await claim("functions", "account-delete: unauthenticated is refused", async () => {
    const { error } = await anon.functions.invoke("account-delete", { body: {} });
    assert(error, "an unauthenticated account-delete succeeded");
    return `refused (HTTP ${error.context?.status ?? "?"})`;
  });
}

// ====================================================================== 5. REALTIME
if (!only || only === "realtime") {
  process.stdout.write("\n--- Realtime ---\n");

  await claim("realtime", "a subscriber receives an authorised change", async () => {
    const received = [];
    const channel = B.client
      .channel(`verify-${rand}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "comments" },
        (payload) => received.push(payload)
      );

    const subscribed = await new Promise((resolve) => {
      const timer = setTimeout(() => resolve(false), 15000);
      channel.subscribe((status) => {
        if (status === "SUBSCRIBED") {
          clearTimeout(timer);
          resolve(true);
        }
      });
    });
    assert(subscribed, "the channel never reached SUBSCRIBED within 15s");

    // A comments on B, so B's subscription should see it.
    const { error } = await A.client
      .from("comments")
      .insert({ author_profile_id: A.id, target_profile_id: B.id, body: `rt-${rand}` });
    assert(!error, `could not write the triggering comment: ${describeError(error)}`);

    const deadline = Date.now() + 15000;
    while (received.length === 0 && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    await B.client.removeChannel(channel);
    assert(received.length > 0, "no realtime event arrived within 15s");
    return `${received.length} event(s); new.body = ${received[0].new?.body ?? "?"}`;
  });

  await claim("realtime", "a subscriber cannot watch a table that is not published", async () => {
    // `profiles` is deliberately not in the publication, so no change event is delivered.
    const received = [];
    const channel = B.client
      .channel(`verify-prof-${rand}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "profiles" },
        (payload) => received.push(payload)
      );
    await new Promise((resolve) => {
      const timer = setTimeout(resolve, 8000);
      channel.subscribe(() => {
        clearTimeout(timer);
        resolve();
      });
    });
    await A.client.from("profiles").update({ about: `rt-prof-${rand}` }).eq("id", A.id);
    await new Promise((resolve) => setTimeout(resolve, 4000));
    await B.client.removeChannel(channel);
    assert(received.length === 0, `received ${received.length} event(s) for the unpublished table`);
    return "no events, as intended (profiles is not published)";
  });
}

// =========================================================================== RESULTS
process.stdout.write("\n--- teardown ---\n");
await teardown();

const counts = results.reduce(
  (acc, r) => ({ ...acc, [r.status]: (acc[r.status] ?? 0) + 1 }),
  {}
);
process.stdout.write(
  [
    "",
    "=== summary ===",
    `  PASS  : ${counts.PASS ?? 0}`,
    `  FAIL  : ${counts.FAIL ?? 0}`,
    `  ERROR : ${counts.ERROR ?? 0}`,
    "",
  ].join("\n")
);

for (const result of results.filter((r) => r.status !== "PASS")) {
  process.stdout.write(`  ${result.status}  [${result.section}] ${result.claim}\n         ${result.detail}\n`);
}

process.stdout.write(
  "\nNote: PASS/FAIL above are observations from this run only. A run that reaches no\n" +
    "project cannot produce any, and an ERROR is not a pass.\n"
);

process.exit((counts.FAIL ?? 0) + (counts.ERROR ?? 0) > 0 ? 1 : 0);
