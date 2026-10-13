import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Static hygiene gate over the shipped frontend source.
 *
 * The production bundle contains no server-side code and no secrets, and the
 * repository rules forbid the patterns below. This is a source scan, not a
 * substitute for a secret scanner on the built bundle, but it fails the build if
 * someone introduces an injection sink or a literal credential into `src/`.
 */
const srcDir = join(process.cwd(), "src");

function sourceFiles(dir = srcDir): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry === "__tests__") continue;
      out.push(...sourceFiles(full));
    } else if (/\.(ts|tsx|scss|css)$/.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

const files = sourceFiles();

function offenders(pattern: RegExp): string[] {
  return files
    .filter((file) => pattern.test(readFileSync(file, "utf8")))
    .map((file) => file.slice(srcDir.length));
}

describe("no HTML/script injection sinks", () => {
  it("never sets raw HTML", () => {
    expect(offenders(/dangerouslySetInnerHTML/)).toEqual([]);
  });

  it("never evaluates strings as code", () => {
    expect(offenders(/\beval\s*\(/)).toEqual([]);
    expect(offenders(/new\s+Function\s*\(/)).toEqual([]);
  });

  it("never writes documents or injects inline scripts", () => {
    expect(offenders(/document\.write/)).toEqual([]);
    expect(offenders(/createContextualFragment/)).toEqual([]);
  });

  it("only assigns location URLs from router navigation, not from raw input", () => {
    expect(offenders(/location\.href\s*=/)).toEqual([]);
  });
});

describe("no credentials in the browser bundle", () => {
  it("does not contain obvious secret literals", () => {
    expect(
      offenders(/(api[_-]?key|secret|password|token)\s*[:=]\s*["'][A-Za-z0-9_-]{16,}["']/i)
    ).toEqual([]);
  });

  it("does not read a non-VITE environment variable into client code", () => {
    expect(offenders(/process\.env\./)).toEqual([]);
  });

  it("only reads the documented VITE_ variables", () => {
    const allowed = new Set([
      "VITE_SUPABASE_URL",
      "VITE_SUPABASE_ANON_KEY",
      "VITE_GOOGLE_MAPS_API_KEY",
      "VITE_YOUTUBE_VIDEO_IDS",
    ]);
    const used = new Set<string>();
    for (const file of files) {
      const text = readFileSync(file, "utf8");
      for (const match of text.matchAll(/import\.meta\.env\.([A-Z0-9_]+)/g)) {
        used.add(match[1]);
      }
    }
    expect([...used].filter((name) => !allowed.has(name))).toEqual([]);
    expect([...used].sort()).toEqual(
      [
        "VITE_GOOGLE_MAPS_API_KEY",
        "VITE_SUPABASE_ANON_KEY",
        "VITE_SUPABASE_URL",
        "VITE_YOUTUBE_VIDEO_IDS",
      ]
    );
  });

  it("does not build an authorization header from a literal token", () => {
    expect(offenders(/Authorization["']?\s*[:=]\s*["'`]Bearer [A-Za-z0-9]{10,}/)).toEqual([]);
  });
});

describe("outbound origins are the intended, documented ones", () => {
  it("only contacts the backend, Google Maps and the privacy-preserving YouTube host", () => {
    const external = new Set<string>();
    for (const file of files) {
      const text = readFileSync(file, "utf8");
      for (const match of text.matchAll(/https?:\/\/([a-z0-9.-]+)/gi)) {
        external.add(match[1].toLowerCase());
      }
    }
    expect([...external].sort()).toEqual([
      "i.ytimg.com",
      "maps.googleapis.com",
      "www.youtube-nocookie.com",
    ]);
  });

  it("does not embed the standard YouTube host, which would set marketing cookies", () => {
    expect(offenders(/www\.youtube\.com\/embed/)).toEqual([]);
  });
});

describe("the Supabase session is namespaced", () => {
  it("pins the session storage key to the project prefix", () => {
    const store = readFileSync(join(srcDir, "lib/supabase.ts"), "utf8");
    const key = /storageKey:\s*"(jibonjori\.[A-Za-z]+)"/.exec(store)?.[1];
    expect(key).toBeDefined();
    expect(key?.startsWith("jibonjori.")).toBe(true);
  });

  it("only touches localStorage through a prefixed supabase-js key", () => {
    expect(offenders(/localStorage\.setItem\(\s*["'](?!jibonjori\.)/)).toEqual([]);
  });
});

describe("no fabricated AI output in the client", () => {
  it("never invents an ML/LLM result with a random number", () => {
    const aiSurfaces = [
      "api/ml-prior.api.ts",
      "api/llm-explanation.api.ts",
      "api/compatibility.api.ts",
      "api/matches.api.ts",
      "components/discovery/CompatibilityPanel.tsx",
      "components/discovery/ProfileCard.tsx",
    ];
    const fabricated = aiSurfaces.filter((relative) => {
      const text = readFileSync(join(srcDir, relative), "utf8");
      return /Math\.random\(\)/.test(text) || /fallback\s*[:=]\s*\{[^}]*available:\s*true/.test(text);
    });
    expect(fabricated).toEqual([]);
  });

  it("renders the backend fallback reason instead of inventing an explanation", () => {
    const panel = readFileSync(join(srcDir, "components/discovery/CompatibilityPanel.tsx"), "utf8");
    expect(panel).toContain("fallback.reason");
    expect(panel).toContain("Not available");
    expect(panel).toContain("No generated explanation");
  });
});
