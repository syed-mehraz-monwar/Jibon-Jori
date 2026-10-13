#!/usr/bin/env node
//
// Mechanical reconciliation of the course requirement matrix.
//
// The authoritative requirement list is `JibonJori_OpenCode_Spec.md`:
//   - the 21 numbered features under "Important and Interesting Features" (`## N. Title`)
//   - the bullets under "## Course Requirement Coverage"
//
// `docs/COURSE_REQUIREMENT_MAPPING.md` must cover every one of those items exactly
// once, and every status must come from the project's status vocabulary.
//
// This script does not invent requirements and does not pad a total. If the spec grows
// a requirement, the mapping must grow a row or this check fails.
//
// Usage:
//   node scripts/check-course-matrix.mjs            # report and exit non-zero on problems
//   node scripts/check-course-matrix.mjs --self-test # also prove the detector fires
//
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SPEC_PATH = resolve(ROOT, "JibonJori_OpenCode_Spec.md");
const MAP_PATH = resolve(ROOT, "docs", "COURSE_REQUIREMENT_MAPPING.md");

const STATUSES = [
  "VERIFIED",
  "PARTIAL",
  "ENVIRONMENT-GATED",
  "BLOCKED",
  "NOT VERIFIED",
  "NOT APPLICABLE",
];
const FORBIDDEN_STATUS_WORDS = ["DONE", "COMPLETE", "PASSED", "FAILED", "WORKING", "TODO"];

function normalize(s) {
  return s
    .replace(/\*\*|__|`/g, "")
    .replace(/[\u2013\u2014]/g, "-")
    .replace(/\s*\/\s*/g, "/")
    .toLowerCase()
    .replace(/[^a-z0-9/]+/g, " ")
    .trim();
}

function splitRow(line) {
  return line
    .split("|")
    .slice(1, -1)
    .map((c) => c.trim());
}

function parseSpec(text) {
  const lines = text.split(/\r?\n/);
  const features = [];
  const coverage = [];
  let inCoverage = false;

  for (const line of lines) {
    if (/^##\s+Course Requirement Coverage\s*$/.test(line)) {
      inCoverage = true;
      continue;
    }
    if (inCoverage) {
      const bullet = line.match(/^-\s+(.+?)\s*$/);
      if (bullet) coverage.push(bullet[1]);
      continue;
    }
    const feature = line.match(/^##\s+(\d+)\.\s+(.+?)\s*$/);
    if (feature) features.push({ n: Number(feature[1]), title: feature[2] });
  }

  return { features, coverage };
}

function parseMapping(text) {
  const sections = {};
  let current = "";
  for (const line of text.split(/\r?\n/)) {
    const heading = line.match(/^##\s+(.+?)\s*$/);
    if (heading) {
      current = heading[1].replace(/\*\*|`/g, "").trim();
      sections[current] ??= [];
      continue;
    }
    if (current) sections[current].push(line);
  }

  const featureSection = Object.keys(sections).find((k) => /^Feature requirements/i.test(k));
  const coverageSection = Object.keys(sections).find((k) =>
    /^Course Requirement Coverage list/i.test(k)
  );
  if (!featureSection || !coverageSection) {
    throw new Error(
      `mapping document is missing an expected section (feature=${featureSection}, coverage=${coverageSection})`
    );
  }

  const featureRows = sections[featureSection]
    .filter((l) => /^\|\s*\d+\s*\|/.test(l))
    .map((l) => {
      const cells = splitRow(l);
      return { n: Number(cells[0]), requirement: cells[1] ?? "", statusCell: cells[3] ?? "" };
    });

  const coverageRows = sections[coverageSection]
    .filter((l) => /^\|/.test(l))
    .map(splitRow)
    .filter((cells) => cells.length >= 3 && cells[0] !== "Requirement" && !/^-+$/.test(cells[0]))
    .map((cells) => ({ requirement: cells[0], statusCell: cells[2] ?? "" }));

  return { featureRows, coverageRows };
}

function statusesIn(cell) {
  const upper = cell.toUpperCase();
  return STATUSES.filter((s) => upper.includes(s));
}

function analyze(specText, mapText) {
  const problems = [];
  const spec = parseSpec(specText);
  const map = parseMapping(mapText);

  if (spec.features.length === 0) problems.push("spec: no numbered features were parsed");
  if (spec.coverage.length === 0) problems.push("spec: no coverage bullets were parsed");

  const specFeatureNums = spec.features.map((f) => f.n);
  for (let i = 1; i <= specFeatureNums.length; i++) {
    if (specFeatureNums[i - 1] !== i) {
      problems.push(`spec: features are not numbered 1..N without gaps (found ${specFeatureNums[i - 1]} at position ${i})`);
    }
  }

  const mapByNum = new Map(map.featureRows.map((r) => [r.n, r]));
  for (const f of spec.features) {
    const row = mapByNum.get(f.n);
    if (!row) {
      problems.push(`mapping: no feature row for spec §${f.n} "${f.title}"`);
      continue;
    }
    if (normalize(row.requirement) !== normalize(f.title)) {
      problems.push(
        `mapping: feature §${f.n} name differs — spec "${f.title}" vs mapping "${row.requirement}"`
      );
    }
    const found = statusesIn(row.statusCell);
    if (found.length === 0) {
      problems.push(`mapping: feature §${f.n} has no recognised status ("${row.statusCell}")`);
    }
    for (const bad of FORBIDDEN_STATUS_WORDS) {
      if (new RegExp(`\\b${bad}\\b`, "i").test(row.statusCell)) {
        problems.push(`mapping: feature §${f.n} uses non-vocabulary status word "${bad}"`);
      }
    }
  }
  for (const row of map.featureRows) {
    if (!spec.features.some((f) => f.n === row.n)) {
      problems.push(`mapping: orphan feature row §${row.n} "${row.requirement}" not in the spec`);
    }
  }

  const mapCoverage = new Map(map.coverageRows.map((r) => [normalize(r.requirement), r]));
  for (const bullet of spec.coverage) {
    const row = mapCoverage.get(normalize(bullet));
    if (!row) {
      problems.push(`mapping: no coverage row for spec bullet "${bullet}"`);
      continue;
    }
    const found = statusesIn(row.statusCell);
    if (found.length === 0) {
      problems.push(`mapping: coverage "${bullet}" has no recognised status ("${row.statusCell}")`);
    }
    for (const bad of FORBIDDEN_STATUS_WORDS) {
      if (new RegExp(`\\b${bad}\\b`, "i").test(row.statusCell)) {
        problems.push(`mapping: coverage "${bullet}" uses non-vocabulary status word "${bad}"`);
      }
    }
  }
  for (const row of map.coverageRows) {
    if (!spec.coverage.some((b) => normalize(b) === normalize(row.requirement))) {
      problems.push(`mapping: orphan coverage row "${row.requirement}" not in the spec`);
    }
  }

  const total = spec.features.length + spec.coverage.length;
  return {
    total,
    specFeatures: spec.features.length,
    specCoverage: spec.coverage.length,
    mapFeatures: map.featureRows.length,
    mapCoverage: map.coverageRows.length,
    problems,
    statusBreakdown: statusesIn(map.featureRows.map((r) => r.statusCell).join(" ")),
  };
}

function report(label, result) {
  console.log(`${label}: TOTAL=${result.total} PROBLEMS=${result.problems.length}`);
  console.log(`  spec features        : ${result.specFeatures}`);
  console.log(`  spec coverage items  : ${result.specCoverage}`);
  console.log(`  mapping feature rows : ${result.mapFeatures}`);
  console.log(`  mapping coverage rows: ${result.mapCoverage}`);
  for (const p of result.problems) console.log(`  PROBLEM: ${p}`);
}

const specText = readFileSync(SPEC_PATH, "utf8");
const mapText = readFileSync(MAP_PATH, "utf8");
const result = analyze(specText, mapText);
report("course matrix", result);

let selfTestOk = true;
if (process.argv.includes("--self-test")) {
  console.log("");
  console.log("self-test (proves the detector fires on injected defects):");
  const mutations = [
    {
      name: "drop one coverage row",
      text: mapText.replace(/^\| Date picker \|.*$/m, ""),
    },
    {
      name: "rename a feature so it no longer matches the spec",
      text: mapText.replace(/^\| 9 \| Advanced search and filtering \|/m, "| 9 | Unrelated title |"),
    },
    {
      name: "introduce a non-vocabulary status",
      text: mapText.replace("**VERIFIED** | 124/124 includes anon reachability", "**DONE** | 124/124 includes anon reachability"),
    },
  ];
  for (const m of mutations) {
    let detected = [];
    try {
      detected = analyze(specText, m.text).problems;
    } catch (err) {
      detected = [`threw: ${err.message}`];
    }
    const ok = detected.length > 0;
    selfTestOk = selfTestOk && ok;
    console.log(`  ${ok ? "detected" : "MISSED  "} ${m.name}${ok ? "" : " <-- detector gap"}`);
  }
}

const failed = result.problems.length > 0 || !selfTestOk || result.total === 0;
if (failed) {
  console.error("");
  console.error("COURSE MATRIX CHECK FAILED");
  process.exit(1);
}
console.log("");
console.log("COURSE MATRIX CHECK PASSED");
