/**
 * Contract parity between the frontend and the Supabase schema.
 *
 * The frontend mirrors the database's domain enums by hand. Until now nothing checked
 * the mirror, and a real mismatch had already slipped through: `Role` was declared
 * `"user" | "admin"` while the PostgreSQL enum is `member | admin`, so a
 * `role === "user"` comparison compiled and never matched. These tests read the
 * migrations and `src/lib/types.ts` so the mirror cannot drift silently.
 *
 * This suite replaced the old REST-path parity test: the application no longer talks
 * to an Express backend, and the corresponding guard is now "no api module can
 * reintroduce the removed HTTP transport".
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const frontendRoot = resolve(process.cwd());
if (!frontendRoot.endsWith("frontend")) {
  throw new Error(`contract-parity must run from the frontend package, got ${frontendRoot}`);
}
const here = join(frontendRoot, "src", "__tests__");
const MIGRATIONS = join(frontendRoot, "..", "supabase", "migrations");

const typesSource = readFileSync(join(here, "..", "lib", "types.ts"), "utf8");

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    return statSync(full).isDirectory() ? walk(full) : [full];
  });
}

/** Extracts `create type public.X as enum ('a', 'b');` blocks from the migrations. */
function sqlEnums(): Map<string, string[]> {
  const found = new Map<string, string[]>();
  for (const file of walk(MIGRATIONS).filter((name) => name.endsWith(".sql"))) {
    const source = readFileSync(file, "utf8");
    for (const match of source.matchAll(/create type public\.(\w+) as enum \(([^)]*)\)/gi)) {
      const values = [...match[2].matchAll(/'([^']*)'/g)].map((entry) => entry[1]).sort();
      found.set(match[1], values);
    }
  }
  return found;
}

/** Extracts `export type Name = "a" | "b";` string unions from the frontend types. */
function frontendUnions(): Map<string, string[]> {
  const found = new Map<string, string[]>();
  const re = /export type (\w+)\s*=\s*([^;]*);/g;
  for (const match of typesSource.matchAll(re)) {
    const members = [...match[2].matchAll(/"([^"]+)"/g)].map((entry) => entry[1]);
    if (members.length > 0) found.set(match[1], members.sort());
  }
  return found;
}

describe("domain enum parity (frontend mirror == Supabase enum)", () => {
  const enums = sqlEnums();
  const unions = frontendUnions();

  const pairs: Array<[string, string]> = [
    ["Role", "user_role"],
    ["Gender", "gender"],
    ["MaritalStatus", "marital_status"],
    ["PhotoVisibility", "photo_visibility"],
    ["NotificationType", "notification_type"],
  ];

  for (const [frontendName, sqlName] of pairs) {
    it(`${frontendName} matches public.${sqlName} exactly`, () => {
      const backend = enums.get(sqlName);
      const frontend = unions.get(frontendName);
      expect(backend, `public.${sqlName} missing from the migrations`).toBeDefined();
      expect(frontend, `${frontendName} missing from src/lib/types.ts`).toBeDefined();
      expect(frontend).toEqual(backend);
    });
  }

  it("Role does not declare a value the database can never return", () => {
    expect(enums.get("user_role")).toEqual(["admin", "member"]);
    expect(unions.get("Role")).not.toContain("user");
  });

  it("UserStatus mirrors the derived account states", () => {
    expect(unions.get("UserStatus")).toEqual(["active", "deleted", "pending", "suspended"]);
  });
});

describe("the removed HTTP backend has not crept back in", () => {
  const apiFiles = walk(join(here, "..", "api")).filter((file) => file.endsWith(".ts"));

  it("finds the api modules", () => {
    expect(apiFiles.length).toBeGreaterThan(10);
  });

  it("no api module calls an `/api/...` route", () => {
    // Doc comments legitimately mention the old routes; only live string literals count.
    const stripComments = (source: string) =>
      source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");
    const offenders = apiFiles.filter((file) =>
      /["'`]\/api\//.test(stripComments(readFileSync(file, "utf8")))
    );
    expect(offenders).toEqual([]);
  });

  it("does not depend on socket.io-client", () => {
    const pkg = JSON.parse(readFileSync(join(frontendRoot, "package.json"), "utf8")) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    expect(pkg.dependencies?.["socket.io-client"]).toBeUndefined();
    expect(pkg.dependencies?.["@supabase/supabase-js"]).toBeDefined();
  });

  it("does not import the deleted socket/storage transports", () => {
    // `lib/socket.ts` (Socket.IO) and `lib/storage.ts` (the bespoke token store)
    // were deleted and must not return. `lib/graphql.ts` is NOT in this list: it
    // was re-created as the Supabase `pg_graphql` transport, which is a different
    // module from the old backend HTTP client. The next test pins that distinction.
    const offenders = walk(join(here, "..")).filter((file) => {
      if (!/\.(ts|tsx)$/.test(file)) return false;
      return /from\s+["'][^"']*lib\/(socket|storage)["']/.test(readFileSync(file, "utf8"));
    });
    expect(offenders).toEqual([]);
  });

  it("the graphql transport targets Supabase, not the deleted `/api/graphql`", () => {
    const source = readFileSync(join(here, "..", "lib", "graphql.ts"), "utf8");
    // It must reach the Supabase project, and must never carry a first-party route.
    expect(source).toMatch(/\/graphql\/v1/);
    expect(source).not.toMatch(/["'`]\/api\//);
    expect(source).toMatch(/env\.supabaseUrl/);
  });
});
