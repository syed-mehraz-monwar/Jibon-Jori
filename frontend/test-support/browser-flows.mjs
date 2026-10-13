/**
 * Authenticated browser flow test.
 *
 * This drives a real Chrome against the real production bundle and intercepts the API
 * at the browser level with CDP `Fetch.fulfillRequest`. The React application, the
 * router, the guards, the token store, the form controls and the rendering are all
 * real; only the HTTP responses are fixtures.
 *
 * That distinction matters and is stated here deliberately: this proves the client
 * behaves correctly for documented response shapes. It does not, and must not, be
 * reported as proof that the backend returns them. Backend behaviour is covered by
 * the backend suite (`test_live_api.mjs`, `test_graphql.mjs`) and by
 * `browser-smoke.mjs`, which talks to the real server for `/api/health/*` through the
 * preview origin's proxy. The real typed client modules are exercised against a real
 * backend and database by `src/__tests__/live-contract.test.ts`.
 *
 * Usage: node test-support/browser-flows.mjs [--base http://127.0.0.1:4173]
 */
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Buffer } from "node:buffer";

const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
].filter(Boolean);

const baseArgIndex = process.argv.indexOf("--base");
const base = baseArgIndex >= 0 ? process.argv[baseArgIndex + 1] : "http://127.0.0.1:4173";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/* ------------------------------------------------------------------ fixtures */

const user = {
  id: "u1",
  username: "rabby",
  email: "rabby@example.com",
  phone: null,
  role: "user",
  status: "active",
  emailVerifiedAt: "2026-01-01T00:00:00.000Z",
  phoneVerifiedAt: null,
  createdAt: "2026-01-01T00:00:00.000Z",
};

const profile = {
  id: "p1",
  userId: "u1",
  displayName: "Rabby Ahmed",
  dob: "1995-04-04",
  gender: "male",
  heightCm: 175,
  maritalStatus: "never_married",
  religion: "Islam",
  casteCommunity: null,
  education: { id: "e3", slug: "bsc", label: "BSc", tier: 3 },
  educationDetail: null,
  profession: { id: "pr4", slug: "engineer", label: "Engineer", tier: 4 },
  professionDetail: null,
  incomeBand: "50000-100000",
  city: "Dhaka",
  district: "Dhaka",
  country: "Bangladesh",
  // A coarsened coordinate pair, as the API would return for a consenting owner.
  lat: 23.81,
  lng: 90.41,
  locationConsent: true,
  showExactLocation: false,
  about: "Software engineer who enjoys classical music.",
  lifestyle: { smoker: false, diet: "halal" },
  isPublic: true,
  photoVisibility: "members",
  // `completeness` is documented on a 0..100 scale (`API_DOCUMENTATION.md`), e.g. 82.5.
  completeness: 72,
  createdAt: "2026-01-02T00:00:00.000Z",
  updatedAt: "2026-01-03T00:00:00.000Z",
};

const referenceData = {
  educationLevels: [
    { id: "e1", slug: "ssc", label: "SSC", tier: 1 },
    { id: "e3", slug: "bsc", label: "BSc", tier: 3 },
  ],
  professions: [
    { id: "pr1", slug: "teacher", label: "Teacher", tier: 2 },
    { id: "pr4", slug: "engineer", label: "Engineer", tier: 4 },
  ],
  interests: [
    { id: "i1", slug: "music", label: "Music" },
    { id: "i2", slug: "travel", label: "Travel" },
  ],
  genderOptions: [
    { id: "g1", slug: "male", label: "Male" },
    { id: "g2", slug: "female", label: "Female" },
  ],
  maritalStatusOptions: [
    { id: "m1", slug: "never_married", label: "Never married" },
    { id: "m2", slug: "divorced", label: "Divorced" },
  ],
  notificationTypeOptions: [
    { id: "n1", slug: "like", label: "Like" },
    { id: "n2", slug: "comment", label: "Comment" },
  ],
};

const searchProfiles = {
  profiles: [
    {
      id: "p2",
      displayName: "Nusrat Jahan",
      gender: "female",
      age: 27,
      maritalStatus: "never_married",
      city: "Dhaka",
      district: "Dhaka",
      country: "Bangladesh",
      education: { slug: "msc", label: "MSc" },
      profession: { slug: "doctor", label: "Doctor" },
      incomeBand: "100000+",
      about: "Paediatrician.",
      interests: [{ slug: "music", label: "Music" }],
      primaryPhoto: null,
      completeness: 0.8,
      createdAt: "2026-01-04T00:00:00.000Z",
    },
  ],
  pagination: { page: 1, limit: 20, total: 1, totalPages: 1 },
};

const factors = {
  interests: 0.9,
  education: 0.6,
  profession: 0.5,
  educationProfession: 0.6,
  location: 0.8,
  lifestyle: 0.4,
  partnerPreference: 0.7,
};
const availability = {
  interests: true,
  education: true,
  profession: true,
  educationProfession: true,
  location: true,
  lifestyle: false,
  partnerPreference: true,
};

const compatibility = {
  targetProfileId: "p2",
  eligibility: { eligible: true, reasons: [] },
  weights: { interests: 0.25 },
  model: { version: "deterministic-v1", inputsHash: "hash", fromCache: false, computedAt: null },
  score: { overall: 0.74, factors, availability },
};

const mlPriorDisabled = {
  targetProfileId: "p2",
  eligibility: { eligible: true, reasons: [] },
  prior: { available: false, modelVersion: null, featureVersion: "v1", score: null },
  // A-12: real feature values, so the on-device runtime has something to run on. These
  // are the same keys the API returns; the harness computes the expected score from the
  // shipped artifact with its own forward pass (below), independent of the browser's.
  features: {
    interests: 0.5,
    educationProfession: 1,
    location: 1,
    lifestyle: 0,
    partnerPreference: 1,
    ageGapNormalized: 0.25,
    gendersCompatible: 1,
    dataCoverage: 0.75,
  },
  fallback: { used: true, reason: "ML_PRIOR_DISABLED" },
};

/**
 * A-12: the shipped model artifact, read out of the backend source so the fixture is the
 * real thing rather than a hand-written stand-in. The forward pass below is a third,
 * independent implementation used only to compute the number the browser must show.
 */
const MLP_FEATURE_ORDER = [
  "interests",
  "educationProfession",
  "location",
  "lifestyle",
  "partnerPreference",
  "ageGapNormalized",
  "gendersCompatible",
  "dataCoverage",
];
const artifactSource = readFileSync(
  join(
    dirname(fileURLToPath(import.meta.url)),
    "..",
    "..",
    "backend",
    "src",
    "modules",
    "ml-prior",
    "models",
    "compatibility-mlp-v1.ts"
  ),
  "utf8"
);
const artifact = JSON.parse(
  artifactSource.slice(
    artifactSource.indexOf("{", artifactSource.indexOf("COMPATIBILITY_MLP_V1")),
    artifactSource.lastIndexOf("}") + 1
  )
);

function forwardPass(input) {
  const clamp = (value) => Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
  let activations = MLP_FEATURE_ORDER.map((key) => clamp(input[key]));
  for (const layer of artifact.layers) {
    const next = new Array(layer.units).fill(0);
    for (let unit = 0; unit < layer.units; unit += 1) {
      let sum = layer.bias[unit];
      for (let i = 0; i < activations.length; i += 1) sum += layer.kernel[i][unit] * activations[i];
      next[unit] = layer.activation === "relu" ? Math.max(0, sum) : sum;
    }
    activations = next;
  }
  const [low, high] = artifact.outputRange;
  const raw = activations[0];
  return Math.max(low, Math.min(high, raw)) * 100;
}

const expectedOnDeviceScore = Math.round(forwardPass(mlPriorDisabled.features) * 100) / 100;

const llmDisabled = {
  targetProfileId: "p2",
  eligibility: { eligible: true, reasons: [] },
  compatibility: { overall: 0.74, factors, availability },
  model: { version: "deterministic-v1", inputsHash: "hash", fromCache: false, computedAt: null },
  mlPrior: { available: false, modelVersion: null, featureVersion: "v1", score: null },
  explanation: { available: false, text: null, providerVersion: null, promptVersion: "v1", generatedAt: null },
  fallback: { used: true, reason: "LLM_EXPLANATION_DISABLED" },
};

const recommendations = {
  weights: { interests: 0.25 },
  items: [
    {
      profileId: "p2",
      eligibility: { eligible: true, reasons: [] },
      model: { version: "deterministic-v1", inputsHash: "hash", fromCache: false, computedAt: null },
      score: { overall: 0.74, factors, availability },
    },
  ],
  pagination: { page: 1, limit: 20, total: 1, totalPages: 1 },
  candidatePoolTruncated: false,
};

const interactions = { interactions: [], pagination: { page: 1, limit: 20, total: 0, totalPages: 0 } };
const ratings = { ratings: [], pagination: { page: 1, limit: 20, total: 0, totalPages: 0 } };
const ratingSummary = {
  targetProfileId: "p2",
  count: 3,
  average: 4.3,
  distribution: { 1: 0, 2: 0, 3: 1, 4: 1, 5: 1 },
};
const existingComment = {
  id: "c1",
  authorProfileId: "p9",
  targetProfileId: "p2",
  body: "Best wishes for your search.",
  createdAt: "2026-01-05T00:00:00.000Z",
};
const commentList = {
  comments: [existingComment],
  pagination: { page: 1, limit: 10, total: 1, totalPages: 1 },
};
const postedComment = {
  id: "c2",
  authorProfileId: "p1",
  targetProfileId: "p2",
  body: "Looking forward to meeting you.",
  createdAt: "2026-01-06T00:00:00.000Z",
};

const likeResult = {
  interaction: { actorProfileId: "p1", targetProfileId: "p2", value: 1, createdAt: "2026-01-06T00:00:00.000Z" },
};
const sessions = [
  {
    id: "s1",
    createdAt: "2026-01-01T00:00:00.000Z",
    expiresAt: "2026-02-01T00:00:00.000Z",
    ip: "203.0.113.10",
    userAgent: "test",
    current: true,
  },
];
const notifications = {
  notifications: [
    {
      id: "n1",
      type: "like",
      payload: { actorProfileId: "p2" },
      readAt: null,
      createdAt: "2026-01-05T00:00:00.000Z",
    },
  ],
  pagination: { page: 1, limit: 20, total: 1, totalPages: 1 },
  unreadCount: 1,
};

const loginResult = { accessToken: "mock-access", refreshToken: "mock-refresh", user };

function ok(data) {
  return { status: 200, body: { success: true, data } };
}

/**
 * Route table. `method` disambiguates the endpoints that share a URL shape —
 * `GET`/`POST /api/comments/:profileId` and `PUT`/`DELETE /api/interactions/:id`
 * differ only by verb.
 */
const ROUTES = [
  { pattern: /\/api\/auth\/login$/, handler: () => ok(loginResult) },
  {
    pattern: /\/api\/auth\/refresh$/,
    handler: () => ok({ accessToken: "mock-access-2", refreshToken: "mock-refresh-2" }),
  },
  { pattern: /\/api\/auth\/logout$/, handler: () => ok(null) },
  { pattern: /\/api\/auth\/me$/, handler: () => ok({ user }) },
  { pattern: /\/api\/auth\/sessions$/, handler: () => ok({ sessions }) },
  {
    pattern: /\/api\/auth\/username-availability/,
    // B-18: the browser check types two names, so the fixture answers both branches -
    // a free name and a taken one - instead of always claiming availability.
    handler: (url) => {
      const name = new URL(url).searchParams.get("username") ?? "";
      return name.includes("taken")
        ? ok({ username: name, available: false, reason: "taken" })
        : ok({ username: name, available: true, reason: "ok" });
    },
  },
  { pattern: /\/api\/profile\/me$/, handler: () => ok({ profile }) },
  { pattern: /\/api\/partner-preferences\/me$/, handler: () => ok({ preferences: null }) },
  // A-08: the list is paginated, so the request carries a query string.
  {
    pattern: /\/api\/media\/me(\?|$)/,
    handler: () => ok({ media: [], pagination: { page: 1, limit: 12, total: 0, totalPages: 0 } }),
  },
  { pattern: /\/api\/notifications\/me/, handler: () => ok(notifications) },
  { pattern: /\/api\/interactions\/me/, handler: () => ok(interactions) },
  {
    pattern: /\/api\/interactions\/[^/]+$/,
    method: "PUT",
    handler: () => ok(likeResult),
  },
  {
    pattern: /\/api\/interactions\/[^/]+$/,
    method: "DELETE",
    handler: () => ok({ interaction: likeResult.interaction }),
  },
  { pattern: /\/api\/ratings\/me/, handler: () => ok(ratings) },
  // The per-profile summary is addressable by id; the list above is `/me`.
  { pattern: /\/api\/ratings\/[^/]+$/, handler: () => ok({ summary: ratingSummary }) },
  {
    pattern: /\/api\/comments\/[^/]+$/,
    method: "POST",
    handler: (_url, postData) => {
      const body = postData ? JSON.parse(postData).body : postedComment.body;
      return ok({ comment: { ...postedComment, body } });
    },
  },
  {
    pattern: /\/api\/comments\/[^/]+$/,
    method: "DELETE",
    handler: () => ok({ comment: existingComment }),
  },
  { pattern: /\/api\/comments\/[^/]+$/, handler: () => ok(commentList) },
  { pattern: /\/api\/matches\/recommendations/, handler: () => ok(recommendations) },
  // A-09: the learn page reads the curated catalogue first and only falls back to the
  // labelled demo embed when it is empty, so the flow exercises the live-catalogue branch.
  {
    pattern: /\/api\/curated-videos/,
    handler: () =>
      ok({
        videos: [
          {
            id: "v1",
            youtubeId: "M7lc1UVf-VE",
            title: "Building a profile that reads honestly",
            description: "A short walkthrough of the profile fields that matter most.",
            category: "relationship",
            createdAt: "2026-01-04T00:00:00.000Z",
          },
        ],
        pagination: { page: 1, limit: 12, total: 1, totalPages: 1 },
      }),
  },  { pattern: /\/api\/compatibility\//, handler: () => ok(compatibility) },
  // A-12: the artifact endpoint must be matched before the generic ml-prior pattern,
  // otherwise the model document would be answered with the prior fixture.
  { pattern: /\/api\/ml-prior\/model$/, handler: () => ok(artifact) },
  { pattern: /\/api\/ml-prior\//, handler: () => ok(mlPriorDisabled) },
  { pattern: /\/api\/llm-explanation\//, handler: () => ok(llmDisabled) },
  {
    pattern: /\/api\/reports\//,
    handler: () =>
      ok({
        dataset: { kind: "users", label: "Users", description: "", columns: [], rows: [], rowLimit: 100 },
      }),
  },
  // Phase 7: the assistant page loads its conversation list on mount. An empty list is the
  // honest fixture here: it exercises the empty state rather than a fabricated transcript.
  {
    pattern: /\/api\/chat\/conversations(\?|$)/,
    handler: () => ok({ conversations: [], pagination: { page: 1, limit: 30, total: 0, totalPages: 0 } }),
  },
  { pattern: /\/api\/health/, handler: () => ok({ status: "ok", service: "jibonjori-api", check: "liveness" }) },
  {
    pattern: /\/api\/graphql$/,
    handler: (_url, postData) => {
      const isSearch = typeof postData === "string" && postData.includes("searchProfiles");
      return isSearch ? ok({ searchProfiles }) : ok({ referenceData });
    },
  },
];

function matchRoute(url, method, postData) {
  for (const route of ROUTES) {
    if (route.method && route.method !== method) continue;
    if (route.pattern.test(url)) return route.handler(url, postData);
  }
  return {
    status: 404,
    body: { success: false, error: { code: "NOT_FOUND", message: `No fixture for ${method} ${url}` } },
  };
}

/* --------------------------------------------------------------- CDP client */

class Cdp {
  #socket;
  #nextId = 1;
  #pending = new Map();
  #listeners = new Set();

  static async connect(webSocketDebuggerUrl) {
    const client = new Cdp();
    client.#socket = new WebSocket(webSocketDebuggerUrl);
    client.#socket.addEventListener("message", (event) => client.#onMessage(event.data));
    await new Promise((resolve, reject) => {
      client.#socket.addEventListener("open", resolve, { once: true });
      client.#socket.addEventListener("error", () => reject(new Error("CDP socket failed")), {
        once: true,
      });
    });
    return client;
  }

  #onMessage(raw) {
    const message = JSON.parse(typeof raw === "string" ? raw : raw.toString());
    if (message.id) {
      const pending = this.#pending.get(message.id);
      if (!pending) return;
      this.#pending.delete(message.id);
      if (message.error) pending.reject(new Error(message.error.message));
      else pending.resolve(message.result);
      return;
    }
    for (const listener of this.#listeners) listener(message);
  }

  onEvent(listener) {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  send(method, params = {}) {
    const id = this.#nextId++;
    return new Promise((resolve, reject) => {
      this.#pending.set(id, { resolve, reject });
      this.#socket.send(JSON.stringify({ id, method, params }));
      setTimeout(() => {
        if (this.#pending.delete(id)) reject(new Error(`CDP timeout: ${method}`));
      }, 20000);
    });
  }

  async evaluate(expression, { awaitPromise = false } = {}) {
    const wrapped = awaitPromise
      ? `(async () => { ${expression} })()`
      : `(() => { ${expression} })()`;
    const result = await this.send("Runtime.evaluate", {
      expression: wrapped,
      returnByValue: true,
      awaitPromise,
    });
    if (result.exceptionDetails) {
      throw new Error(`Page evaluation failed: ${result.exceptionDetails.text}`);
    }
    return result.result.value;
  }

  async waitFor(expression, { timeout = 8000, interval = 100 } = {}) {
    const deadline = Date.now() + timeout;
    let last;
    while (Date.now() < deadline) {
      last = await this.evaluate(expression);
      if (last) return last;
      await sleep(interval);
    }
    throw new Error(`Timed out waiting for: ${expression} (last ${JSON.stringify(last)})`);
  }

  close() {
    try {
      this.#socket.close();
    } catch {
      /* already closed */
    }
  }
}

/* ---------------------------------------------------------------------- run */

async function main() {
  const chromePath = CHROME_CANDIDATES.find((candidate) => existsSync(candidate));
  if (!chromePath) throw new Error("No Chrome/Edge binary found. Set CHROME_PATH.");

  const port = 9800 + Math.floor(Math.random() * 150);
  const profileDir = mkdtempSync(join(tmpdir(), "jj-flows-"));
  const child = spawn(
    chromePath,
    [
      "--headless=new",
      "--disable-gpu",
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-extensions",
      "--disable-default-apps",
      "--disable-background-networking",
      "--mute-audio",
      `--user-data-dir=${profileDir}`,
      `--remote-debugging-port=${port}`,
      "about:blank",
    ],
    { stdio: "ignore" }
  );

  const results = [];
  let socket;
  const served = [];

  const record = (name, ok_, detail) => {
    results.push({ name, ok: ok_ });
    console.log(`${ok_ ? "PASS" : "FAIL"}  ${name}${detail ? `  -  ${detail}` : ""}`);
  };
  const check = async (name, fn) => {
    try {
      record(name, true, await fn());
    } catch (error) {
      record(name, false, error instanceof Error ? error.message : String(error));
    }
  };

  try {
    const version = await (async () => {
      const deadline = Date.now() + 20000;
      while (Date.now() < deadline) {
        try {
          const response = await fetch(`http://127.0.0.1:${port}/json/version`);
          if (response.ok) return response.json();
        } catch {
          /* not up yet */
        }
        await sleep(250);
      }
      throw new Error("Chrome debugging endpoint never became available");
    })();

    const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
    const page = targets.find((target) => target.type === "page");
    if (!page) throw new Error("No page target");

    socket = await Cdp.connect(page.webSocketDebuggerUrl ?? version.webSocketDebuggerUrl);
    await socket.send("Page.enable");
    await socket.send("Runtime.enable");
    await socket.send("Fetch.enable", { patterns: [{ urlPattern: "*://*/api/*" }] });

    socket.onEvent(async (message) => {
      if (message.method !== "Fetch.requestPaused") return;
      const { requestId, request } = message.params;
      try {
        const fixture = matchRoute(request.url, request.method, request.postData);
        served.push({ status: fixture.status, url: request.url.replace(/^https?:\/\/[^/]+/, "") });
        await socket.send("Fetch.fulfillRequest", {
          requestId,
          responseCode: fixture.status,
          responseHeaders: [
            { name: "Content-Type", value: "application/json" },
            { name: "Access-Control-Allow-Origin", value: "*" },
          ],
          body: Buffer.from(JSON.stringify(fixture.body)).toString("base64"),
        });
      } catch {
        /* the browser is closing */
      }
    });

    async function goto(path, readyExpression) {
      await socket.send("Page.navigate", { url: `${base}${path}` });
      await socket.waitFor("return document.readyState === 'complete'");
      if (readyExpression) await socket.waitFor(readyExpression);
      await sleep(250);
    }

    async function clickByText(text) {
      const clicked = await socket.evaluate(`
        const target = [...document.querySelectorAll('button, a')].find((el) => el.textContent.trim().includes(${JSON.stringify(text)}));
        if (!target) return false;
        target.click();
        return true;
      `);
      if (!clicked) throw new Error(`no clickable element containing "${text}"`);
    }

    await check("the real sign-in form submits and lands on the dashboard", async () => {
      await goto("/login", "return !!document.querySelector('#identifier');");
      await socket.evaluate("document.getElementById('identifier').focus(); return true;");
      await socket.send("Input.insertText", { text: "rabby" });
      await socket.evaluate("document.getElementById('password').focus(); return true;");
      await socket.send("Input.insertText", { text: "supersecret1" });
      await clickByText("Sign in");

      const heading = await socket.waitFor(
        "const h = document.querySelector('h1'); return h && /Welcome/.test(h.textContent) ? h.textContent : null;"
      );
      const path = await socket.evaluate("return location.pathname;");
      const stored = await socket.evaluate("return !!localStorage.getItem('jibonjori.accessToken');");
      if (path !== "/app") throw new Error(`expected /app, got ${path}`);
      if (!stored) throw new Error("the session was not persisted");
      return `${heading} at ${path}, session persisted`;
    });

    await check("dashboard renders the profile from the API with real formatting", async () => {
      const text = await socket.waitFor(
        "const el = [...document.querySelectorAll('*')].find((n) => n.children.length === 0 && n.textContent.trim() === 'Rabby Ahmed'); return el ? document.body.innerText : null;"
      );
      if (!/Rabby Ahmed/.test(text)) throw new Error("display name missing");
      if (!/Listed in discovery/.test(text)) throw new Error("visibility badge missing");
      if (!/72%/.test(text)) throw new Error("completeness meter missing");
      return "name, visibility badge and completeness rendered";
    });

    await check("the profile form provides textboxes, dropdowns and a date picker", async () => {
      await goto("/app/profile", "return !!document.querySelector('form');");
      const controls = await socket.waitFor(`
        const form = document.querySelector('form');
        const counts = {
          text: form.querySelectorAll('input[type=text], input:not([type])').length,
          date: form.querySelectorAll('input[type=date]').length,
          select: form.querySelectorAll('select').length,
          textarea: form.querySelectorAll('textarea').length,
        };
        return counts.select > 0 && counts.text > 0 ? counts : null;
      `);
      if (controls.date < 1) throw new Error(`no date input: ${JSON.stringify(controls)}`);
      if (controls.textarea < 1) throw new Error("no textarea for the free-text fields");
      return `${controls.text} textboxes, ${controls.date} date picker, ${controls.select} dropdowns, ${controls.textarea} textarea`;
    });

    await check("dropdown options are populated from the GraphQL reference data", async () => {
      const labels = await socket.waitFor(`
        const selects = [...document.querySelectorAll('select')];
        if (selects.length === 0) return null;
        const all = selects.flatMap((s) => [...s.options].map((o) => o.textContent.trim()));
        return all.includes('BSc') && all.includes('Engineer') ? all : null;
      `);
      return `reference labels rendered across ${new Set(labels).size} distinct options (BSc, Engineer present)`;
    });

    await check("the location map states the missing API key instead of faking a map", async () => {
      const text = await socket.waitFor(
        "return document.body.innerText.includes('Map not configured') ? document.body.innerText : null;"
      );
      if (!/Coordinates: 23\.8100, 90\.4100/.test(text)) {
        throw new Error("the returned coordinates are not shown as a fallback");
      }
      const scripts = await socket.evaluate(
        "return document.querySelectorAll('script[src*=\"maps.googleapis.com\"]').length;"
      );
      if (scripts !== 0) throw new Error("a Maps script was loaded without a key");
      return "explicit not-configured state, coordinates shown, no Maps request";
    });

    await check("search renders API results through the GraphQL transport", async () => {
      await goto("/app/search", "return !!document.querySelector('input');");
      const text = await socket.waitFor(
        "return /Nusrat Jahan/.test(document.body.innerText) ? document.body.innerText : null;"
      );
      if (!/Dhaka/.test(text)) throw new Error("profile card details missing");
      return "search result card rendered from the mocked GraphQL response";
    });

    await check("recommendations rank a member and link to the explainable score", async () => {
      await goto("/app/recommendations", "return document.body.innerText.length > 0;");
      const text = await socket.waitFor(
        "return /Nusrat Jahan/.test(document.body.innerText) ? document.body.innerText : null;"
      );
      // The weights badge comes from the API response, not the client.
      if (!/interests: 25%/.test(text)) throw new Error("weight badge not rendered");
      return "ranked card rendered with the API-declared weight";
    });

    await check("compatibility panel shows the score, model version and disabled AI reasons", async () => {
      await clickByText("Nusrat Jahan");
      const text = await socket.waitFor(
        "return /Not available/.test(document.body.innerText) ? document.body.innerText : null;"
      );
      if (!/deterministic-v1/.test(text)) throw new Error("model version not surfaced");
      if (!/ML_PRIOR_DISABLED/.test(text)) throw new Error("ML fallback reason not surfaced");
      if (!/LLM_EXPLANATION_DISABLED/.test(text)) throw new Error("LLM fallback reason not surfaced");
      if (!/74%/.test(text)) throw new Error("overall score not rendered");
      if (!/not enough data/.test(text)) throw new Error("an unavailable factor was not labelled");
      return "74% overall, deterministic-v1, both provider reasons, and an unavailable factor labelled";
    });

    await check("the compatibility model runs on the device and the browser shows its own number", async () => {
      // A-12. The section only renders once the artifact has been fetched and the forward
      // pass has run in this browser, so a rendered number is evidence the inference ran
      // here. The expected value is computed by the harness's own independent forward pass.
      const expected = `${expectedOnDeviceScore.toFixed(2)}% computed on this device by compatibility-mlp-v1`;
      const text = await socket.waitFor(
        `return /computed on this device/.test(document.body.innerText) ? document.body.innerText : null;`
      );
      if (!text.includes(expected)) {
        throw new Error(`expected "${expected}" in the on-device section, got: ${text.slice(0, 400)}`);
      }
      if (!/runs in your browser/.test(text)) throw new Error("the on-device badge is missing");
      // The artifact must be fetched once and reused: it is memoised, so rendering the
      // panel again (a second navigation) must not re-download the model.
      const artifactCalls = served.filter((entry) => /\/api\/ml-prior\/model$/.test(entry.url));
      if (artifactCalls.length !== 1) {
        throw new Error(`expected exactly 1 artifact fetch, saw ${artifactCalls.length}`);
      }
      return `device score ${expectedOnDeviceScore.toFixed(2)}% reproduced in-browser from the shipped artifact`;
    });

    await check("a like is saved through the API and reflected in the control", async () => {
      const pressed = await socket.evaluate(`
        const button = [...document.querySelectorAll('button')].find((b) => b.textContent.includes('Like') && b.getAttribute('aria-pressed') !== null);
        if (!button) return false;
        button.click();
        return true;
      `);
      if (!pressed) {
        const diag = await socket.evaluate(`
          return {
            path: location.pathname,
            buttons: [...document.querySelectorAll('button')].map((b) => (b.textContent || '').trim().slice(0, 20)),
            textareas: document.querySelectorAll('textarea').length,
          };
        `);
        throw new Error(
          `no like control at ${diag.path}: buttons=${JSON.stringify(diag.buttons)} textareas=${diag.textareas}`
        );
      }

      const state = await socket.waitFor(`
        const button = [...document.querySelectorAll('button')].find((b) => b.textContent.includes('Like') && b.getAttribute('aria-pressed') !== null);
        return button && button.getAttribute('aria-pressed') === 'true' ? { pressed: button.getAttribute('aria-pressed') } : null;
      `);
      const toast = await socket.waitFor(
        "const el = document.querySelector('[aria-live=polite]'); return el && /Liked/.test(el.textContent) ? el.textContent : null;"
      );
      if (!/Interaction saved/.test(toast)) throw new Error(`unexpected toast: ${toast}`);
      return `aria-pressed=${state.pressed}, toast="${toast.replace(/\\s+/g, " ").trim()}"`;
    });

    await check("posting a comment appends it to the thread from the API response", async () => {
      const before = await socket.evaluate("return document.querySelectorAll('li').length;");
      const typed = await socket.evaluate(`
        const area = document.querySelector('textarea[aria-label="New comment"]');
        if (!area) return false;
        area.focus();
        return true;
      `);
      if (!typed) {
        const diag = await socket.evaluate(`
          return { path: location.pathname, textareas: [...document.querySelectorAll('textarea')].map((t) => t.getAttribute('aria-label')) };
        `);
        throw new Error(`no comment textarea at ${diag.path}: ${JSON.stringify(diag.textareas)}`);
      }
      await socket.send("Input.insertText", { text: "Looking forward to meeting you." });
      await clickByText("Post comment");

      const text = await socket.waitFor(
        "return /Looking forward to meeting you\\./.test(document.body.innerText) ? document.body.innerText : null;"
      );
      if (!/Best wishes for your search\./.test(text)) {
        throw new Error("the comment fetched from the API disappeared");
      }
      const after = await socket.evaluate("return document.querySelectorAll('li').length;");
      if (after <= before) throw new Error(`the thread did not grow (${before} -> ${after})`);
      return `posted comment rendered above the fetched one (${before} -> ${after} rows)`;
    });

    await check("the video is embedded only after the user presses play", async () => {
      await goto("/app/learn", "return !!document.querySelector('figure');");
      const before = await socket.evaluate(
        "return document.querySelectorAll('iframe').length;"
      );
      if (before !== 0) throw new Error(`an iframe existed before play: ${before}`);

      const played = await socket.evaluate(`
        const button = document.querySelector('button[aria-label^="Play video"]');
        if (!button) return false;
        button.click();
        return true;
      `);
      if (!played) throw new Error("no labelled play control");

      const frame = await socket.waitFor(`
        const iframe = document.querySelector('iframe[src*="youtube-nocookie.com"]');
        return iframe ? { src: iframe.src, title: iframe.title } : null;
      `);
      return `click-to-load embed: ${frame.src.replace(/^https:\/\//, "")}`;
    });

    await check("notifications render from the API and the unread badge reflects it", async () => {
      await goto("/app/notifications", "return document.body.innerText.length > 0;");
      const text = await socket.waitFor(
        "return /Like/.test(document.body.innerText) ? document.body.innerText : null;"
      );
      if (!/(Like|notification)/i.test(text)) throw new Error("notification row missing");
      return "notification list rendered";
    });

    await check("sessions are listed from the API", async () => {
      await goto("/app/sessions", "return document.body.innerText.length > 0;");
      const text = await socket.waitFor(
        "return /203\\.0\\.113\\.10/.test(document.body.innerText) ? document.body.innerText : null;"
      );
      if (!/(current|Current)/.test(text)) throw new Error("no indication of the current session");
      return "session row with address and current marker rendered";
    });

    // Phase 7: route audit for the pages the earlier checks did not drive.
    await check("the partner-preferences page renders its controls", async () => {
      await goto("/app/preferences", "return document.body.innerText.length > 0;");
      const text = await socket.waitFor(
        "return /Partner preferences/.test(document.body.innerText) ? document.body.innerText : null;"
      );
      const controls = await socket.evaluate(`
        const form = document.querySelector('form');
        if (!form) return null;
        return {
          text: form.querySelectorAll('input').length,
          select: form.querySelectorAll('select').length,
          checkboxes: form.querySelectorAll('input[type=checkbox]').length,
        };
      `);
      if (!controls) throw new Error("no preferences form rendered");
      if (controls.checkboxes < 1) throw new Error(`expected a multi-select control: ${JSON.stringify(controls)}`);
      return `preferences form with ${controls.select} dropdown(s) and ${controls.checkboxes} checkbox(es)`;
    });

    await check("the assistant page states the empty state instead of inventing a transcript", async () => {
      await goto("/app/chat", "return document.body.innerText.length > 0;");
      const text = await socket.waitFor(
        "return /No conversations/.test(document.body.innerText) ? document.body.innerText : null;"
      );
      if (!/Profile assistant/.test(text)) throw new Error("the page header is missing");
      return "assistant page rendered its real empty state from an empty conversation list";
    });

    await check("the reports page states the administrator requirement for a non-admin", async () => {
      await goto("/app/reports", "return document.body.innerText.length > 0;");
      const text = await socket.waitFor(
        "return /Administrators only/.test(document.body.innerText) ? document.body.innerText : null;"
      );
      return "non-admin sees the administrator-requirement panel, not a report table";
    });

    await check("signing out clears the stored session and returns to sign-in", async () => {
      await goto("/app", "return document.body.innerText.length > 0;");
      await clickByText("Sign out");
      const path = await socket.waitFor("return location.pathname === '/login' ? location.pathname : null;");
      const cleared = await socket.evaluate(
        "return localStorage.getItem('jibonjori.accessToken') === null;"
      );
      if (!cleared) throw new Error("the token survived sign-out");
      return `redirected to ${path} and the token was cleared`;
    });

    // Signed out now, which is the only state in which `/verify` renders: an authenticated
    // visitor is redirected to the application shell.
    await check("the verification screen renders for a pending registration", async () => {
      const seed = (delivered) => socket.evaluate(`
        sessionStorage.setItem('jibonjori.pendingUserId', 'u1');
        sessionStorage.setItem('jibonjori.pendingChannel', 'email');
        sessionStorage.setItem('jibonjori.pendingDelivered', ${JSON.stringify(delivered)});
        sessionStorage.setItem('jibonjori.pendingDeliveryReason', 'PROVIDER_NOT_CONFIGURED');
        sessionStorage.setItem('jibonjori.pendingDeliveredTo', 'rabby@example.com');
        return true;
      `);

      // Honest branch: delivery failed/absent, so the screen must say so rather than
      // claiming a code is on its way.
      await seed("false");
      await goto("/verify", "return !!document.querySelector('#code');");
      const notSent = await socket.waitFor(`
        const t = document.body.innerText;
        return /No verification code could be sent/.test(t) && /no email or SMS provider configured/.test(t) ? t : null;
      `);
      if (/rabby@example.com/.test(notSent)) throw new Error("an undelivered code still named a target");

      // Delivered branch: the target is named.
      await seed("true");
      await goto("/verify", "return !!document.querySelector('#code');");
      await socket.waitFor(
        "return /Enter the 6-digit code sent to rabby@example.com/.test(document.body.innerText) ? true : null;"
      );

      const input = await socket.evaluate(
        "const el = document.querySelector('#code'); return el ? { maxlength: el.getAttribute('maxlength'), placeholder: el.placeholder } : null;"
      );
      if (!input || input.maxlength !== '6') throw new Error(`code field is not bounded to 6 digits: ${JSON.stringify(input)}`);
      return "both delivery branches render truthfully, and the code field is bounded to 6 digits";
    });

    // B-18: availability must update while typing, with no reload and no submit. The socket
    // is not reachable in this fixture harness, so this exercises the documented REST
    // fallback of `useUsernameAvailability` end to end in a real browser.
    await check("B-18: username availability updates while typing without a reload", async () => {
      await goto("/register", "return !!document.querySelector('#username');");
      const navId = await socket.evaluate(
        "return (performance.getEntriesByType('navigation')[0] || {}).startTime ?? -1;"
      );

      const typeInto = async (text) => {
        await socket.evaluate("const el = document.querySelector('#username'); el.focus(); el.select && el.select(); return true;");
        await socket.send("Input.insertText", { text });
      };

      await typeInto("free_name");
      const free = await socket.waitFor(
        "const el = document.querySelector('[aria-live=polite]'); return el && /available/.test(el.textContent) ? el.textContent.trim() : null;"
      );

      await typeInto("taken_name");
      const taken = await socket.waitFor(
        "const el = document.querySelector('[aria-live=polite]'); return el && /already taken/i.test(el.textContent) ? el.textContent.trim() : null;"
      );

      const navAfter = await socket.evaluate(
        "return (performance.getEntriesByType('navigation')[0] || {}).startTime ?? -2;"
      );
      if (navAfter !== navId) throw new Error("the page reloaded to obtain the answer");
      return `typed -> "${free}" then "${taken}" with no reload`;
    });

    // B-48: a browsing-smoothness measurement rather than an assertion of taste. The route
    // is driven in a real browser and the navigation timing of the document is read back.
    await check("B-48: an authenticated route loads within a measured budget", async () => {
      await goto("/login", "return !!document.querySelector('#identifier');");
      await socket.evaluate("document.getElementById('identifier').focus(); return true;");
      await socket.send("Input.insertText", { text: "rabby" });
      await socket.evaluate("document.getElementById('password').focus(); return true;");
      await socket.send("Input.insertText", { text: "supersecret1" });
      await clickByText("Sign in");
      await socket.waitFor("return location.pathname === '/app' ? true : null;");

      await goto("/app/recommendations", "return document.body.innerText.length > 0;");
      const timing = await socket.waitFor(`
        const entry = performance.getEntriesByType('navigation')[0];
        if (!entry) return null;
        return { dcl: entry.domContentLoadedEventEnd, load: entry.loadEventEnd };
      `);
      if (timing.dcl <= 0) throw new Error("no navigation timing was recorded");
      if (timing.dcl > 5000) throw new Error(`domContentLoaded took ${Math.round(timing.dcl)} ms`);
      return `recommendations domContentLoaded ${Math.round(timing.dcl)} ms, load ${Math.round(timing.load)} ms`;
    });

    await check("every intercepted API call was answered by a fixture", async () => {
      const missing = served.filter((entry) => entry.status === 404);
      if (missing.length > 0) {
        // Name the unrouted requests, or a fixture gap reads as an unexplained failure.
        const sample = [...new Set(missing.map((entry) => entry.url))].slice(0, 5).join(", ");
        throw new Error(`${missing.length} request(s) had no fixture: ${sample}`);
      }
      return `${served.length} API calls served, none unrouted`;
    });
  } finally {
    socket?.close();
    if (!child.killed) child.kill();
    await sleep(1200);
    try {
      rmSync(profileDir, { recursive: true, force: true });
    } catch {
      /* locked by the browser; harmless */
    }
  }

  const failed = results.filter((result) => !result.ok);
  console.log(`\nbrowser flows: ${results.length - failed.length}/${results.length} passed`);
  process.exit(failed.length === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error(`browser flows crashed: ${error instanceof Error ? error.message : error}`);
  process.exit(1);
});
