/**
 * Real-browser smoke test for the JibonJori frontend.
 *
 * Chrome's `--dump-dom` flag is unreliable in this environment (it returns
 * nothing for any non-`data:` URL), so this drives Chrome through the DevTools
 * Protocol instead: it launches a private headless Chrome, connects over the
 * WebSocket debugging endpoint, navigates real routes, reads the rendered DOM,
 * performs real keystrokes, and reads computed styles. That makes the Tailwind,
 * Sass and reduced-motion checks genuine browser assertions rather than
 * jsdom approximations.
 *
 * Usage:  node test-support/browser-smoke.mjs [--base http://127.0.0.1:5173]
 * Exit:   0 when every check passes, 1 otherwise.
 *
 * No dependency is added: the DevTools client below is ~60 lines using the
 * `WebSocket` global that ships with Node.
 */
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
].filter(Boolean);

const baseArgIndex = process.argv.indexOf("--base");
const base = baseArgIndex >= 0 ? process.argv[baseArgIndex + 1] : "http://127.0.0.1:5173";

// The Supabase project the app was built against, used only by the reachability check.
// It is the same public value Vite inlines at build time; when it is absent the check
// reports a skip rather than guessing a URL.
const supabaseArgIndex = process.argv.indexOf("--supabase-url");
const supabaseUrl = (
  (supabaseArgIndex >= 0 ? process.argv[supabaseArgIndex + 1] : undefined) ??
  process.env.VITE_SUPABASE_URL ??
  ""
)
  .trim()
  .replace(/\/+$/, "");

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Thrown by a check whose precondition is absent; reported as SKIP, never as a pass. */
class SkipCheck extends Error {}

function findChrome() {
  const found = CHROME_CANDIDATES.find((candidate) => existsSync(candidate));
  if (!found) throw new Error("No Chrome/Edge binary found. Set CHROME_PATH.");
  return found;
}

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
      if (message.error) pending.reject(new Error(`${message.error.message}`));
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
    // An async body is required when the snippet uses `await`.
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
    throw new Error(`Timed out waiting for: ${expression} (last value ${JSON.stringify(last)})`);
  }

  close() {
    try {
      this.#socket.close();
    } catch {
      /* already closed */
    }
  }
}

async function main() {
  const chromePath = findChrome();
  const port = 9400 + Math.floor(Math.random() * 400);
  const profile = mkdtempSync(join(tmpdir(), "jj-browser-"));
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
      "--disable-sync",
      "--mute-audio",
      `--user-data-dir=${profile}`,
      `--remote-debugging-port=${port}`,
      "about:blank",
    ],
    { stdio: "ignore" }
  );

  const results = [];
  let browserWs = null;
  let pageWs = null;
  let socket;
  const consoleErrors = [];

  const record = (name, ok, detail) => {
    results.push({ name, ok, detail });
    console.log(`${ok === "skip" ? "SKIP" : ok ? "PASS" : "FAIL"}  ${name}${detail ? `  -  ${detail}` : ""}`);
  };

  async function check(name, fn) {
    try {
      const detail = await fn();
      record(name, true, detail);
    } catch (error) {
      if (error instanceof SkipCheck) {
        record(name, "skip", error.message);
        return;
      }
      record(name, false, error instanceof Error ? error.message : String(error));
    }
  }

  try {
    // Wait for the debugging endpoint, then attach to the real page target.
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
    browserWs = version.webSocketDebuggerUrl;

    const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
    const page = targets.find((target) => target.type === "page");
    if (!page) throw new Error("No page target in the headless browser");
    pageWs = page.webSocketDebuggerUrl;

    socket = await Cdp.connect(pageWs);
    await socket.send("Page.enable");
    await socket.send("Runtime.enable");
    await socket.send("Log.enable");
    await socket.send("Network.enable");

    socket.onEvent((message) => {
      if (message.method === "Runtime.exceptionThrown") {
        consoleErrors.push(message.params.exceptionDetails.text ?? "exception");
      }
      if (
        message.method === "Log.entryAdded" &&
        message.params.entry.level === "error" &&
        !/favicon/i.test(message.params.entry.text)
      ) {
        consoleErrors.push(message.params.entry.text);
      }
    });

    async function goto(path, readyExpression = "return !!document.getElementById('root');") {
      consoleErrors.length = 0;
      await socket.send("Page.navigate", { url: `${base}${path}` });
      await socket.waitFor(`return document.readyState === 'complete'`);
      await socket.waitFor(readyExpression);
      // Let effects and the tail of the render commit.
      await sleep(300);
    }

    await check("landing page renders React output into #root", async () => {
      await goto("/");
      const info = await socket.evaluate(`
        const root = document.getElementById('root');
        const h1 = document.querySelector('h1');
        return { children: root.children.length, heading: h1 ? h1.textContent.trim() : null };
      `);
      if (!info.heading || !/Find a partner with/.test(info.heading)) {
        throw new Error(`unexpected h1: ${JSON.stringify(info)}`);
      }
      return `h1="${info.heading}"`;
    });

    await check("Tailwind CSS is compiled and applied by the browser", async () => {
      const color = await socket.evaluate(`
        const button = [...document.querySelectorAll('button')].find((b) => /Create an account/.test(b.textContent));
        if (!button) return null;
        const style = getComputedStyle(button);
        return { background: style.backgroundColor, color: style.color, radius: style.borderRadius };
      `);
      if (!color || !/^rgb\(/.test(color.background) || color.background === "rgba(0, 0, 0, 0)") {
        throw new Error(`Tailwind utility not applied: ${JSON.stringify(color)}`);
      }
      return `background=${color.background} radius=${color.radius}`;
    });

    await check("Sass stylesheet is compiled and applied by the browser", async () => {
      const hero = await socket.evaluate(`
        const element = document.querySelector('.jj-hero');
        if (!element) return null;
        const style = getComputedStyle(element);
        return { backgroundImage: style.backgroundImage, radius: style.borderRadius };
      `);
      if (!hero || !/gradient|url\(/.test(hero.backgroundImage)) {
        throw new Error(`Sass class not applied: ${JSON.stringify(hero)}`);
      }
      return `background-image=${hero.backgroundImage.slice(0, 48)}...`;
    });

    await check("GSAP drives the hero entrance animation", async () => {
      await goto("/");
      const evidence = await socket.waitFor(
        `
        const el = document.querySelector('[data-hero-title]');
        if (!el) return null;
        const inline = el.getAttribute('style') || '';
        if (!/opacity|transform/.test(inline)) return null;
        if (getComputedStyle(el).opacity !== '1') return null;
        return { inline };
      `,
        { timeout: 8000 }
      );
      return `GSAP wrote the inline style and settled it: ${evidence.inline}`;
    });

    await check("client-side validation blocks an empty sign-in without calling the API", async () => {
      await goto("/login", "return !!document.querySelector('form');");
      await socket.evaluate(`
        const button = [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Sign in');
        button.click();
        return true;
      `);
      const alert = await socket.waitFor(
        "const el = document.querySelector('[role=alert]'); return el ? el.textContent : null;"
      );
      const apiCalls = await socket.evaluate(
        "return performance.getEntriesByType('resource').filter((e) => e.name.includes('/auth/v1/')).length;"
      );
      if (!/Enter your username/.test(alert)) throw new Error(`unexpected alert: ${alert}`);
      if (apiCalls !== 0) throw new Error(`expected no auth request, saw ${apiCalls}`);
      return `alert="${alert}" and 0 auth requests`;
    });

    await check("real keystrokes reach the controlled React inputs", async () => {
      await goto("/login", "return !!document.querySelector('#identifier');");
      await socket.evaluate("document.getElementById('identifier').focus(); return true;");
      await socket.send("Input.insertText", { text: "ra" });
      await socket.send("Input.insertText", { text: "bby" });
      const value = await socket.waitFor("return document.getElementById('identifier').value || null;");
      if (value !== "rabby") throw new Error(`unexpected input value: ${value}`);
      return `identifier field accepted browser text input -> "${value}"`;
    });

    await check("unknown route renders the 404 page", async () => {
      await goto("/definitely-not-a-route", "return document.body.textContent.includes('does not exist');");
      const text = await socket.evaluate("return document.body.innerText;");
      if (!/This page does not exist/.test(text)) throw new Error("404 copy missing");
      return "404 copy rendered";
    });

    await check("protected routes redirect an anonymous visitor to sign-in", async () => {
      await goto("/app/search", "return !!document.querySelector('#identifier');");
      const path = await socket.evaluate("return location.pathname;");
      if (path !== "/login") throw new Error(`expected /login, landed on ${path}`);
      return "redirected to /login";
    });

    await check("reduced-motion is honoured end to end", async () => {
      await socket.send("Emulation.setEmulatedMedia", {
        features: [{ name: "prefers-reduced-motion", value: "reduce" }],
      });
      await goto("/", "return !!document.querySelector('h1');");
      const reduced = await socket.evaluate(
        "return matchMedia('(prefers-reduced-motion: reduce)').matches;"
      );
      const opacities = await socket.evaluate(`
        return [...document.querySelectorAll('.jj-card-interactive')].map((el) => getComputedStyle(el.parentElement).opacity);
      `);
      if (!reduced) throw new Error("emulated media did not apply");
      if (opacities.some((value) => Number(value) < 1)) {
        throw new Error(`content left hidden under reduced motion: ${opacities.join(",")}`);
      }
      return `matchMedia=true and ${opacities.length} revealed cards at opacity 1`;
    });

    await check("the layout reflows and does not overflow at a mobile viewport", async () => {
      const gridProbe = `
        const grid = [...document.querySelectorAll('.grid')].find((el) => (el.className || '').includes('sm:grid-cols-2'));
        if (!grid) return null;
        return {
          width: window.innerWidth,
          overflow: document.documentElement.scrollWidth - window.innerWidth,
          columns: getComputedStyle(grid).gridTemplateColumns.split(' ').length,
          heroWidth: Math.round(document.querySelector('[data-hero-title]').getBoundingClientRect().width),
        };
      `;

      await socket.send("Emulation.setDeviceMetricsOverride", {
        width: 1280,
        height: 900,
        deviceScaleFactor: 1,
        mobile: false,
      });
      await goto("/", "return !!document.querySelector('h1');");
      const desktop = await socket.evaluate(gridProbe);

      await socket.send("Emulation.setDeviceMetricsOverride", {
        width: 375,
        height: 812,
        deviceScaleFactor: 2,
        mobile: true,
      });
      await goto("/", "return !!document.querySelector('h1');");
      const mobile = await socket.evaluate(gridProbe);

      await socket.send("Emulation.clearDeviceMetricsOverride");

      if (!desktop || !mobile) throw new Error("the responsive feature grid was not found");
      if (desktop.columns !== 2) throw new Error(`expected 2 columns at 1280px, saw ${desktop.columns}`);
      if (mobile.columns !== 1) throw new Error(`expected 1 column at 375px, saw ${mobile.columns}`);
      if (mobile.overflow > 1) throw new Error(`mobile layout scrolls horizontally by ${mobile.overflow}px`);
      if (desktop.overflow > 1) throw new Error(`desktop layout scrolls horizontally by ${desktop.overflow}px`);
      if (mobile.heroWidth > mobile.width) throw new Error("the hero title overflows the viewport");
      return `1280px -> ${desktop.columns} columns; 375px -> ${mobile.columns} column, overflow ${mobile.overflow}px`;
    });

    await check("the Supabase project is reachable from the page origin", async () => {
      if (supabaseUrl.length === 0) {
        throw new SkipCheck("pass --supabase-url (or set VITE_SUPABASE_URL) to check reachability");
      }
      await socket.send("Emulation.setEmulatedMedia", { features: [] });
      await goto("/");
      // A cross-origin `fetch` from the app's own origin is the real test: if Supabase
      // did not answer with the right CORS headers the promise would reject with a
      // TypeError, regardless of the status code. An unauthenticated 401 is a *pass*:
      // it proves the request reached the REST endpoint.
      const probe = await socket.evaluate(
        `
        try {
          const response = await fetch(${JSON.stringify(supabaseUrl)} + '/rest/v1/', {
            headers: { apikey: 'probe' },
          });
          return { ok: true, status: response.status };
        } catch (error) {
          return { ok: false, error: String(error) };
        }
      `,
        { awaitPromise: true }
      );
      if (!probe.ok) throw new Error(`Supabase is unreachable from the page: ${probe.error}`);
      if (probe.status >= 500) throw new Error(`Supabase returned ${probe.status} for a probe request`);
      return `cross-origin fetch to ${supabaseUrl}/rest/v1/ resolved with ${probe.status}`;
    });

    await check("no uncaught console errors on the public routes", async () => {
      await goto("/");
      await goto("/login", "return !!document.querySelector('form');");
      const unexpected = consoleErrors.filter(
        (entry) => !/Failed to load resource|net::ERR|favicon/i.test(entry)
      );
      if (unexpected.length > 0) throw new Error(unexpected.join(" | "));
      return "no exceptions or error-level logs";
    });
  } finally {
    socket?.close();
    if (!child.killed) child.kill();
    await sleep(1200);
    try {
      rmSync(profile, { recursive: true, force: true });
    } catch {
      /* the browser may still hold a lock; harmless */
    }
  }

  const failed = results.filter((result) => result.ok === false);
  const skipped = results.filter((result) => result.ok === "skip");
  console.log(
    `\nbrowser smoke: ${results.length - failed.length - skipped.length}/${results.length} passed` +
      (skipped.length > 0 ? `, ${skipped.length} skipped` : "") +
      (browserWs ? "" : " (no browser endpoint)")
  );
  if (results.length === 0) {
    console.log(`browser endpoints: ${browserWs ?? "(none)"} / ${pageWs ?? "(none)"}`);
  }
  process.exit(failed.length === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error(`browser smoke crashed: ${error instanceof Error ? error.message : error}`);
  process.exit(1);
});
