/**
 * Static deployment-configuration gate for the frontend service (R-025).
 *
 * The Docker daemon is unavailable in this environment, so the image cannot be
 * built or run and no runtime claim is made. What *can* be verified without a
 * daemon is the content and internal consistency of the deployment artifacts:
 * that this server is now a pure static host with no first-party API upstream,
 * that the CSP allows every external origin the bundle can reference (Google
 * Maps, the YouTube embed, and the Supabase project), that the image passes the
 * public Supabase values in at build time and fails closed if the built bundle
 * cannot reach a backend, and that no secret is baked into either file. This
 * script asserts exactly that and exits non-zero on any failure, so it can be
 * wired into CI.
 *
 * Usage: node test-support/deployment-config.mjs
 */
import { readFileSync, existsSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const results = [];
function check(name, fn) {
  try {
    const detail = fn();
    results.push({ name, ok: true });
    console.log(`PASS  ${name}${detail ? `  -  ${detail}` : ""}`);
  } catch (error) {
    results.push({ name, ok: false });
    console.log(`FAIL  ${name}  -  ${error instanceof Error ? error.message : error}`);
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const nginxPath = join(root, "nginx.conf");
const dockerfilePath = join(root, "Dockerfile");
const dockerignorePath = join(root, ".dockerignore");
const envExamplePath = join(root, ".env.example");

const nginx = readFileSync(nginxPath, "utf8");
const dockerfile = readFileSync(dockerfilePath, "utf8");
const dockerignore = readFileSync(dockerignorePath, "utf8");
const envExample = readFileSync(envExamplePath, "utf8");

check("nginx serves the SPA with a client-route fallback", () => {
  assert(/try_files\s+\$uri\s+\$uri\/\s+\/index\.html/.test(nginx), "no `try_files ... /index.html` fallback");
  return "leaf routes such as /app/search resolve to index.html";
});

check("nginx is a static host with no first-party API upstream", () => {
  // The data layer moved to Supabase, so a proxied `/api/` or `/socket.io/`
  // location would be dead configuration that hides a stale architecture.
  assert(!/location\s+\/api\//.test(nginx), "a leftover `location /api/` block exists");
  assert(!/location\s+\/socket\.io\//.test(nginx), "a leftover `location /socket.io/` block exists");
  assert(!/proxy_pass\b/.test(nginx), "nginx still proxies to an upstream");
  return "no /api/ or /socket.io/ proxy; every request is served from disk";
});

check("nginx treats hashed assets as immutable and the shell as uncacheable", () => {
  assert(/location\s+\/assets\/\s*\{[\s\S]*?try_files\s+\$uri\s+=404/.test(nginx), "a missing asset must 404, not fall back to the shell");
  assert(/immutable/.test(nginx), "hashed assets are not marked immutable");
  assert(/location\s+=\s+\/index\.html\s*\{[\s\S]*?no-cache/.test(nginx), "the shell is not marked no-cache");
  return "assets immutable + missing asset 404 + index.html no-cache";
});

check("nginx does not advertise its version and compresses text assets", () => {
  assert(/server_tokens\s+off/.test(nginx), "server_tokens is not off");
  assert(/gzip\s+on/.test(nginx), "gzip is not enabled");
  return "server_tokens off, gzip on";
});

check("the image builds the SPA in a dependency-cached stage", () => {
  assert(/^FROM\s+node:[\d.]+-[\w-]+\s+AS\s+build/m.test(dockerfile), "no node build stage");
  assert(/COPY\s+package\.json\s+package-lock\.json/.test(dockerfile), "the lockfile is not copied");
  assert(/RUN\s+npm\s+ci/.test(dockerfile), "install is not from the lockfile (`npm ci`)");
  assert(/RUN[\s\S]*?npm\s+run\s+build/.test(dockerfile), "the SPA is not built in the image");
  return "node build stage runs `npm ci` then `npm run build`";
});

check("the build stage receives the public Supabase values as build args", () => {
  // Vite inlines VITE_* at build time, so they cannot be supplied at container
  // start; ARG is the only correct mechanism. The runtime stage must not carry
  // them, and the service_role key must never appear at all.
  const buildStage = dockerfile.split(/^FROM\s/m)[1] ?? "";
  for (const name of ["VITE_SUPABASE_URL", "VITE_SUPABASE_ANON_KEY"]) {
    assert(
      new RegExp(`^\\s*ARG\\s+${name}\\s*$`, "m").test(buildStage),
      `${name} is not declared as an ARG in the build stage`
    );
    assert(
      new RegExp(`npm run build`).test(buildStage) && buildStage.includes(name),
      `${name} is declared but never passed to the build`
    );
  }
  const runtimeStage = dockerfile.split(/^FROM\s/m)[2] ?? "";
  assert(!/VITE_SUPABASE/.test(runtimeStage), "a Supabase value leaks into the runtime stage");
  assert(!/SERVICE_ROLE/.test(dockerfile), "the Dockerfile mentions a service role key");
  return "VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY as build args only";
});

check("the image fails closed when the built bundle cannot reach a backend", () => {
  assert(
    /grep[\s\S]*?dist[\s\S]*?exit 1/.test(dockerfile),
    "the build does not verify that the Supabase URL is embedded in dist/"
  );
  return "docker build fails if the bundle lacks VITE_SUPABASE_URL";
});

check("the image serves the built output from nginx", () => {
  assert(/^FROM\s+nginx:/m.test(dockerfile), "no nginx runtime stage");
  assert(
    /COPY\s+--from=build\s+\/app\/dist\s+\/usr\/share\/nginx\/html/.test(dockerfile),
    "the build output is not copied into the web root"
  );
  assert(
    /COPY\s+nginx\.conf\s+\/etc\/nginx\/conf\.d\/default\.conf/.test(dockerfile),
    "the static-server config is not installed"
  );
  return "runtime stage serves dist/ from /usr/share/nginx/html";
});

check("the image exposes a port, a healthcheck and a graceful stop signal", () => {
  assert(/EXPOSE\s+80/.test(dockerfile), "no EXPOSE");
  assert(/HEALTHCHECK[\s\S]*?127\.0\.0\.1/.test(dockerfile), "no HEALTHCHECK against the local server");
  assert(/STOPSIGNAL\s+SIGQUIT/.test(dockerfile), "no STOPSIGNAL (nginx needs SIGQUIT for a graceful stop)");
  assert(/CMD\s+\["nginx",\s*"-g",\s*"daemon off;"\]/.test(dockerfile), "nginx is not the foreground command");
  return "EXPOSE 80 + HEALTHCHECK + STOPSIGNAL SIGQUIT + foreground nginx";
});

check("every local path the Dockerfile copies exists", () => {
  // Line-based, because a greedy regex over the whole file swallows instructions.
  const copies = dockerfile
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => /^COPY\s/.test(line) && !/^COPY\s+--from=/.test(line))
    .flatMap((line) => line.replace(/^COPY\s+/, "").split(/\s+/).slice(0, -1));
  assert(copies.length > 0, "no local COPY instructions found");
  const missing = copies.filter((source) => !existsSync(join(root, source)));
  assert(missing.length === 0, `missing build context paths: ${missing.join(", ")}`);
  return `verified ${copies.length} copied paths: ${copies.join(", ")}`;
});

check(".dockerignore keeps build noise and secrets out of the context", () => {
  for (const entry of ["node_modules", "dist", ".env"]) {
    assert(
      dockerignore.split(/\r?\n/).map((line) => line.trim()).includes(entry),
      `.dockerignore does not exclude ${entry}`
    );
  }
  return "node_modules, dist and .env are excluded";
});

/** Returns the index of the `}` matching the `{` at `openIndex`, or -1. */
function matchingBrace(text, openIndex) {
  let depth = 0;
  for (let i = openIndex; i < text.length; i += 1) {
    if (text[i] === "{") depth += 1;
    else if (text[i] === "}") {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/** Parses the nginx `server` and `location` blocks with their bodies. */
function nginxBlocks(text) {
  const blocks = [];
  for (const m of text.matchAll(/(?:^|\n)\s*(server\s*|location\s+[^{]*)\{/g)) {
    const openIndex = m.index + m[0].length - 1;
    const closeIndex = matchingBrace(text, openIndex);
    if (closeIndex < 0) continue;
    blocks.push({ name: m[1].trim(), body: text.slice(openIndex + 1, closeIndex) });
  }
  return blocks;
}

check("nginx sends the security header set, and repeats it wherever it adds a header", () => {
  // nginx drops inherited `add_header` directives in any location block that
  // declares one of its own, so a location that sets Cache-Control and forgets the
  // CSP would silently serve its responses without the security headers.
  const REQUIRED = [
    "X-Content-Type-Options",
    "X-Frame-Options",
    "Referrer-Policy",
    "Permissions-Policy",
    "Cross-Origin-Opener-Policy",
    "Content-Security-Policy",
  ];

  const blocks = nginxBlocks(nginx);
  assert(blocks.length >= 4, `expected server + location blocks, parsed ${blocks.length}`);

  const offenders = [];
  for (const block of blocks) {
    const added = [...block.body.matchAll(/add_header\s+(\S+)/g)].map((m) => m[1]);
    if (added.length === 0) continue; // inherits nothing extra; server-level headers apply
    const missing = REQUIRED.filter((header) => !added.includes(header));
    if (missing.length > 0) offenders.push(`${block.name} missing ${missing.join(",")}`);
  }
  assert(offenders.length === 0, `add_header inheritance would drop headers: ${offenders.join("; ")}`);

  const server = blocks.find((b) => b.name === "server");
  assert(server, "no server block was parsed");
  for (const header of REQUIRED) {
    assert(
      new RegExp(`add_header\\s+${header}\\s+`).test(server.body),
      `server block does not send ${header}`
    );
  }
  assert(
    !/add_header\s+Strict-Transport-Security/.test(nginx),
    "HSTS belongs at the TLS terminator, not on this plain-HTTP server"
  );
  return `${REQUIRED.length} headers at server level and in all ${blocks.length - 1} location blocks`;
});

check("the CSP permits exactly the resource origins the app can load, and no inline script", () => {
  const cspMatch = nginx.match(/add_header\s+Content-Security-Policy\s+"([^"]+)"/);
  assert(cspMatch, "no Content-Security-Policy value");
  const csp = cspMatch[1];

  const directives = new Map();
  for (const part of csp.split(";")) {
    const [name, ...values] = part.trim().split(/\s+/);
    if (name) directives.set(name, values);
  }

  const host = (value) => value.replace(/^[a-z]+:\/\//i, "").replace(/\/.*$/, "").toLowerCase();

  const allows = (directive, origin) => {
    const target = host(origin);
    return (directives.get(directive) ?? []).some((token) => {
      if (token === "*") return true;
      const allowedHost = host(token);
      if (allowedHost === target) return true;
      if (allowedHost.startsWith("*.")) return target.endsWith(allowedHost.slice(1));
      return false;
    });
  };

  // Every origin the application can actually load, and the directive that governs it.
  // The Maps SDK injects its own asset and tile hosts under gstatic/googleapis at
  // runtime, so those are allowed by subdomain wildcard rather than enumerated. The
  // Supabase project host is a deployment value, so it is covered by the same
  // `*.supabase.co` wildcard: REST/GraphQL calls and the Realtime socket use
  // connect-src, and Storage signed URLs for profile photos use img-src.
  const REQUIRED_ORIGINS = [
    ["script-src", "https://maps.googleapis.com"],
    ["connect-src", "https://maps.googleapis.com"],
    ["connect-src", "https://abcdefghijklmnop.supabase.co"],
    ["connect-src", "wss://abcdefghijklmnop.supabase.co"],
    ["img-src", "https://abcdefghijklmnop.supabase.co"],
    ["img-src", "https://i.ytimg.com"],
    ["img-src", "https://maps.gstatic.com"],
    ["img-src", "https://khms0.googleapis.com"],
    ["frame-src", "https://www.youtube-nocookie.com"],
  ];
  const blocked = REQUIRED_ORIGINS.filter(([d, o]) => !allows(d, o)).map(([d, o]) => `${d} ${o}`);
  assert(blocked.length === 0, `the CSP would block assets the app loads: ${blocked.join(", ")}`);

  const scriptSrc = directives.get("script-src") ?? [];
  assert(scriptSrc.includes("'self'"), "script-src does not allow the app bundle");
  assert(scriptSrc.length === 2, `script-src should be 'self' plus the Maps host only, got: ${scriptSrc.join(" ")}`);
  assert(directives.get("object-src")?.includes("'none'"), "object-src is not locked down");
  assert(directives.get("frame-ancestors")?.includes("'none'"), "the app can still be framed");
  assert(directives.get("base-uri")?.includes("'self'"), "base-uri is not restricted");
  assert(directives.get("form-action")?.includes("'self'"), "form-action is not restricted");
  assert(directives.get("default-src")?.includes("'self'"), "default-src is not 'self'");

  // `default-src 'self'` would otherwise silently govern any directive that is
  // forgotten, so the Supabase origin must be named in connect-src explicitly
  // rather than relied on to fall through.
  assert(!directives.get("default-src").includes("*.supabase.co"), "default-src is too broad");

  const distDir = join(root, "dist");
  if (!existsSync(distDir)) return "CSP directives verified (no dist/ to inspect)";

  const shell = readFileSync(join(distDir, "index.html"), "utf8");
  assert(
    !/<script(?![^>]*\bsrc=)/i.test(shell),
    "dist/index.html contains an inline script, which script-src 'self' would block"
  );
  return `CSP permits all ${REQUIRED_ORIGINS.length} required origins; shell has no inline script`;
});

check("no secret is baked into the deployment artifacts", () => {
  const forbidden = [
    /JWT_SECRET/,
    /OTP_HASH_SECRET/,
    /DATABASE_URL/,
    /postgresql:\/\//,
    /(?:ARG|ENV)\s+\S*SERVICE_ROLE\S*/,
    /service_role\s*[:=]\s*\S/,
  ];
  // Prose may explain what must NOT be passed (the Dockerfile does exactly that),
  // so comment lines are stripped before the Dockerfile is searched.
  const dockerfileCode = dockerfile.replace(/^[ \t]*#.*$/gm, "");
  for (const pattern of forbidden) {
    assert(!pattern.test(dockerfileCode), `Dockerfile contains ${pattern}`);
    assert(!pattern.test(nginx), `nginx.conf contains ${pattern}`);
    assert(!pattern.test(envExample), `.env.example contains ${pattern}`);
  }
  // The public values are passed as build args, never as a runtime `ENV`, so they
  // cannot be read out of the running container's environment.
  assert(
    !/ENV\s+VITE_SUPABASE/.test(dockerfile),
    "a VITE_ value is baked into the image environment instead of passed as a build arg"
  );
  return "no credential literal in Dockerfile, nginx.conf or .env.example";
});

check("the environment template documents exactly the supported variables", () => {
  const declared = [...envExample.matchAll(/^\s*(VITE_[A-Z0-9_]+)\s*=/gm)].map((m) => m[1]).sort();
  const expected = [
    "VITE_GOOGLE_MAPS_API_KEY",
    "VITE_SUPABASE_ANON_KEY",
    "VITE_SUPABASE_URL",
    "VITE_YOUTUBE_VIDEO_IDS",
  ];
  assert(
    JSON.stringify(declared) === JSON.stringify(expected),
    `.env.example declares ${declared.join(", ") || "(nothing)"}, expected ${expected.join(", ")}`
  );
  // The removed backend-era variables must not creep back in anywhere.
  const removed = /VITE_API_BASE_URL|VITE_SOCKET_URL|VITE_DEV_BACKEND_URL/;
  for (const [label, text] of [
    [".env.example", envExample],
    ["Dockerfile", dockerfile],
    ["nginx.conf", nginx],
  ]) {
    assert(!removed.test(text), `${label} still references a removed backend variable`);
  }
  return "4 variables documented; no backend-era VITE_ variable remains";
});

check("the static config is non-empty and well-formed enough to parse", () => {
  assert(statSync(nginxPath).size > 500, "nginx.conf is suspiciously small");
  const opens = (nginx.match(/\{/g) ?? []).length;
  const closes = (nginx.match(/\}/g) ?? []).length;
  assert(opens === closes, `unbalanced braces in nginx.conf (${opens} open, ${closes} close)`);
  const directives = (nginx.match(/;\s*$/gm) ?? []).length;
  assert(directives > 15, `only ${directives} terminated directives found`);
  return `${opens} balanced blocks, ${directives} terminated directives`;
});

const failed = results.filter((result) => !result.ok);
console.log(`\ndeployment config: ${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length === 0 ? 0 : 1);
