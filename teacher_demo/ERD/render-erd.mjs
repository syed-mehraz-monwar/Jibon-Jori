#!/usr/bin/env node
// Renders teacher_demo ERD diagrams to SVG with zero dependencies.
// Layouts are explicit (x, y per table); edges are straight FK connectors.
// Run: node teacher_demo/ERD/render-erd.mjs
import { writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const esc = (s) =>
  String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const CHAR = 7.4; // approx px per char at 13px Consolas

function col(text, key) {
  const mark = key === "PK" ? "PK " : key === "FK" ? "FK " : key === "PKFK" ? "PK·FK " : "";
  return { text: `${mark}${text}`, type: "", key };
}

function render(name, tables, edges, W, H) {
  const boxes = new Map();
  let out = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" font-family="Consolas, 'Courier New', monospace">\n`;
  out += `<rect width="${W}" height="${H}" fill="#f8fafc"/>\n`;
  out += `<text x="24" y="34" font-size="20" font-weight="bold" fill="#0f172a">${esc(name)}</text>\n`;
  out += `<text x="24" y="56" font-size="12" fill="#64748b">JibonJori — PostgreSQL (Supabase). PK = primary key, FK = foreign key. Lines: FK column points at its parent table.</text>\n`;
  for (const t of tables) {
    const rows = t.cols.map((c) => (c.type ? `${c.text} : ${c.type}` : c.text));
    const w = Math.max(
      t.w ?? 240,
      t.name.length * 8.4 + 60,
      ...rows.map((r) => r.length * CHAR + 28)
    );
    const h = 34 + rows.length * 21 + 10;
    boxes.set(t.name, { x: t.x, y: t.y, w, h });
    out += `<g>\n<rect x="${t.x}" y="${t.y}" width="${w.toFixed(0)}" height="${h}" rx="8" fill="#ffffff" stroke="#334155" stroke-width="1.5"/>\n`;
    out += `<rect x="${t.x}" y="${t.y}" width="${w.toFixed(0)}" height="30" rx="8" fill="#1e3a5f"/>\n`;
    out += `<rect x="${t.x}" y="${t.y + 18}" width="${w.toFixed(0)}" height="12" fill="#1e3a5f"/>\n`;
    out += `<text x="${t.x + 12}" y="${t.y + 20}" font-size="13" font-weight="bold" fill="#ffffff">${esc(t.name)}</text>\n`;
    rows.forEach((r, i) => {
      const c = t.cols[i];
      const fill = c.key === "PK" ? "#0f172a" : c.key === "FK" || c.key === "PKFK" ? "#1d4ed8" : "#334155";
      const weight = c.key ? "bold" : "normal";
      out += `<text x="${t.x + 12}" y="${t.y + 52 + i * 21}" font-size="12.5" font-weight="${weight}" fill="${fill}">${esc(r)}</text>\n`;
    });
    out += `</g>\n`;
  }
  const anchor = (b, side) =>
    side === "l"
      ? [b.x, b.y + b.h / 2]
      : side === "r"
        ? [b.x + b.w, b.y + b.h / 2]
        : side === "t"
          ? [b.x + b.w / 2, b.y]
          : [b.x + b.w / 2, b.y + b.h];
  for (const e of edges) {
    const a = boxes.get(e.from);
    const b = boxes.get(e.to);
    if (!a || !b) throw new Error(`unknown edge endpoint ${e.from} -> ${e.to}`);
    const [x1, y1] = anchor(a, e.fs ?? "r");
    const [x2, y2] = anchor(b, e.ts ?? "l");
    out += `<line x1="${x1.toFixed(0)}" y1="${y1.toFixed(0)}" x2="${x2.toFixed(0)}" y2="${y2.toFixed(0)}" stroke="#64748b" stroke-width="1.4"/>\n`;
    out += `<circle cx="${x2.toFixed(0)}" cy="${y2.toFixed(0)}" r="3.4" fill="#1d4ed8"/>\n`;
    const mx = (x1 + x2) / 2;
    const my = (y1 + y2) / 2;
    out += `<text x="${mx.toFixed(0)}" y="${(my - 5).toFixed(0)}" font-size="10.5" fill="#0f172a" text-anchor="middle" stroke="#f8fafc" stroke-width="3" paint-order="stroke">${esc(e.label)}</text>\n`;
  }
  out += `</svg>\n`;
  return out;
}

// ---------------- simplified ----------------
const S = [
  { name: "education_levels", x: 30, y: 90, cols: [col("id uuid", "PK"), { text: "slug text UK" }, { text: "label text" }, { text: "tier smallint" }] },
  { name: "professions", x: 30, y: 300, cols: [col("id uuid", "PK"), { text: "slug text UK" }, { text: "label text" }, { text: "tier smallint" }] },
  { name: "interests", x: 30, y: 510, cols: [col("id uuid", "PK"), { text: "slug text UK" }, { text: "label text" }] },
  { name: "profiles", x: 330, y: 200, cols: [col("id uuid", "PK"), { text: "username citext UK" }, { text: "display_name text" }, { text: "dob date 18+" }, { text: "gender enum" }, { text: "city text" }, col("education_id uuid", "FK"), col("profession_id uuid", "FK"), { text: "is_public bool" }, { text: "role enum" }] },
  { name: "partner_preferences", x: 330, y: 620, cols: [col("profile_id uuid", "PKFK"), { text: "age_min/max smallint" }, { text: "genders text[]" }, { text: "locations text[]" }] },
  { name: "profile_interests", x: 650, y: 90, cols: [col("profile_id uuid", "PKFK"), col("interest_id uuid", "PKFK")] },
  { name: "media", x: 650, y: 270, cols: [col("id uuid", "PK"), col("profile_id uuid", "FK"), { text: "storage_path text UK" }, { text: "kind enum" }, { text: "is_primary bool" }] },
  { name: "interactions", x: 650, y: 510, cols: [col("actor_profile_id uuid", "PKFK"), col("target_profile_id uuid", "PKFK"), { text: "value -1/1/2" }] },
  { name: "ratings", x: 650, y: 720, cols: [col("id uuid", "PK"), col("rater_profile_id uuid", "FK"), col("rated_profile_id uuid", "FK"), { text: "score 1..5" }] },
  { name: "comments", x: 970, y: 90, cols: [col("id uuid", "PK"), col("author_profile_id uuid", "FK"), col("target_profile_id uuid", "FK"), { text: "body text" }] },
  { name: "compatibility_scores", x: 970, y: 330, cols: [col("profile_a_id uuid", "PKFK"), col("profile_b_id uuid", "PKFK"), { text: "overall_score 0..100" }, { text: "model_version text" }, { text: "inputs_hash text" }] },
  { name: "notifications", x: 970, y: 590, cols: [col("id uuid", "PK"), col("profile_id uuid", "FK"), { text: "type enum" }, { text: "read_at timestamptz" }] },
];
const SE = [
  { from: "education_levels", to: "profiles", label: "education_id", fs: "r", ts: "l" },
  { from: "professions", to: "profiles", label: "profession_id", fs: "r", ts: "l" },
  { from: "profiles", to: "partner_preferences", label: "1:1 CASCADE", fs: "b", ts: "t" },
  { from: "profiles", to: "profile_interests", label: "1:N", fs: "t", ts: "l" },
  { from: "interests", to: "profile_interests", label: "1:N", fs: "r", ts: "l" },
  { from: "profiles", to: "media", label: "1:N", fs: "r", ts: "l" },
  { from: "profiles", to: "interactions", label: "actor+target", fs: "r", ts: "l" },
  { from: "profiles", to: "ratings", label: "rater+rated", fs: "b", ts: "l" },
  { from: "profiles", to: "comments", label: "author+target", fs: "t", ts: "l" },
  { from: "profiles", to: "compatibility_scores", label: "pair a,b", fs: "r", ts: "l" },
  { from: "profiles", to: "notifications", label: "1:N", fs: "r", ts: "l" },
];

// ---------------- complete ----------------
const C = [
  { name: "auth_users*", x: 30, y: 90, cols: [col("id uuid", "PK")] },
  { name: "education_levels", x: 30, y: 220, cols: [col("id uuid", "PK"), { text: "slug UK" }, { text: "label" }, { text: "tier 0..10" }] },
  { name: "professions", x: 30, y: 430, cols: [col("id uuid", "PK"), { text: "slug UK" }, { text: "label" }, { text: "tier 0..10" }] },
  { name: "interests", x: 30, y: 640, cols: [col("id uuid", "PK"), { text: "slug UK" }, { text: "label" }] },
  { name: "ml_artifacts", x: 30, y: 830, cols: [col("id uuid", "PK"), { text: "name" }, { text: "version UK" }, { text: "is_active bool" }] },
  { name: "profiles", x: 330, y: 90, cols: [col("id uuid", "PK"), { text: "username citext UK" }, { text: "display_name" }, { text: "dob 18+" }, { text: "gender/marital/religion" }, { text: "city/district/country" }, { text: "lat/lng paired" }, col("education_id", "FK"), col("profession_id", "FK"), { text: "about/lifestyle" }, { text: "is_public/role/flags" }, { text: "created/updated_at" }] },
  { name: "partner_preferences", x: 330, y: 560, cols: [col("profile_id", "PKFK"), { text: "age_min/max" }, { text: "genders/locations[]" }] },
  { name: "profile_interests", x: 330, y: 770, cols: [col("profile_id", "PKFK"), col("interest_id", "PKFK")] },
  { name: "media", x: 660, y: 90, cols: [col("id", "PK"), col("profile_id", "FK"), { text: "storage_path UK" }, { text: "kind/mime/bytes" }, { text: "is_primary" }] },
  { name: "interactions", x: 660, y: 330, cols: [col("actor_profile_id", "PKFK"), col("target_profile_id", "PKFK"), { text: "value -1/1/2" }] },
  { name: "ratings", x: 660, y: 540, cols: [col("id", "PK"), col("rater_profile_id", "FK"), col("rated_profile_id", "FK"), { text: "score 1..5" }] },
  { name: "comments", x: 660, y: 750, cols: [col("id", "PK"), col("author_profile_id", "FK"), col("target_profile_id", "FK"), { text: "body 1..1000" }] },
  { name: "compatibility_scores", x: 990, y: 90, cols: [col("profile_a_id", "PKFK"), col("profile_b_id", "PKFK"), { text: "6 factor scores" }, { text: "model_version" }, { text: "inputs_hash" }] },
  { name: "notifications", x: 990, y: 340, cols: [col("id", "PK"), col("profile_id", "FK"), { text: "type/payload" }, { text: "read_at" }] },
  { name: "chat_conversations", x: 990, y: 560, cols: [col("id", "PK"), col("profile_id", "FK"), { text: "title" }] },
  { name: "chat_messages", x: 990, y: 750, cols: [col("id", "PK"), col("conversation_id", "FK"), { text: "role/content" }] },
  { name: "curated_videos", x: 1300, y: 90, cols: [col("id", "PK"), { text: "youtube_id UK" }, { text: "title/category" }, col("created_by", "FK")] },
  { name: "audit_logs", x: 1300, y: 340, cols: [col("id", "PK"), { text: "actor_user_id" }, { text: "action/target/meta" }] },
];
const CE = [
  { from: "auth_users*", to: "profiles", label: "id CASCADE", fs: "r", ts: "l" },
  { from: "education_levels", to: "profiles", label: "RESTRICT", fs: "r", ts: "l" },
  { from: "professions", to: "profiles", label: "RESTRICT", fs: "r", ts: "l" },
  { from: "profiles", to: "partner_preferences", label: "1:1", fs: "b", ts: "t" },
  { from: "profiles", to: "profile_interests", label: "1:N", fs: "b", ts: "t" },
  { from: "interests", to: "profile_interests", label: "1:N", fs: "r", ts: "l" },
  { from: "profiles", to: "media", label: "1:N", fs: "t", ts: "l" },
  { from: "profiles", to: "interactions", label: "actor/target", fs: "r", ts: "l" },
  { from: "profiles", to: "ratings", label: "rater/rated", fs: "r", ts: "l" },
  { from: "profiles", to: "comments", label: "author/target", fs: "r", ts: "l" },
  { from: "profiles", to: "compatibility_scores", label: "pair", fs: "t", ts: "l" },
  { from: "profiles", to: "notifications", label: "1:N", fs: "r", ts: "l" },
  { from: "profiles", to: "chat_conversations", label: "1:N", fs: "r", ts: "l" },
  { from: "chat_conversations", to: "chat_messages", label: "1:N", fs: "b", ts: "t" },
  { from: "profiles", to: "curated_videos", label: "SET NULL", fs: "t", ts: "l" },
  { from: "auth_users*", to: "audit_logs", label: "SET NULL", fs: "r", ts: "l" },
];

writeFileSync(join(HERE, "simplified-erd.svg"), render("Simplified ERD — core user/profile/matchmaking slice", S, SE, 1260, 950));
writeFileSync(join(HERE, "complete-erd.svg"), render("Complete ERD — all 17 tables (*auth_users is Supabase Auth, external)", C, CE, 1600, 1010));
console.log("wrote simplified-erd.svg + complete-erd.svg");
