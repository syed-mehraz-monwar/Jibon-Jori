// =============================================================================
// reports - administrative report datasets for the report screens and for
// Crystal Reports.
// =============================================================================
// Contract: GET ?kind=<kind>&targetProfileId=<uuid>&format=json|csv
//
//   kind = users | matchmaking | compatibility | ratings | ratings-summary | admin
//
// `compatibility` and `ratings-summary` require `targetProfileId`; the others
// reject it as noise. Unknown kind -> 400 VALIDATION_ERROR; non-admin -> 403.
//
// Response (json): { dataset: { kind, label, description, columns, rowLimit, rows } }
// Response (csv):  text/csv
//
// The kind list, column names, column types and row limits are copied from the
// archived binding specification
// (`migration_evidence/extracted/CRYSTAL_REPORTS_DATASET_BINDING.md` and
// `reports.service.ts`) so this endpoint stays the documented data source. Every
// row comes from a `report_*` SQL function; those are SECURITY DEFINER and each
// re-checks `is_admin()` itself, so this endpoint's own admin check is the second
// gate, not the only one.
//
// No demo or synthetic rows are ever produced: an empty dataset is returned as an
// empty dataset, and `rowLimit` tells a consumer whether the dataset was capped.
// =============================================================================

import { handler, HttpError, json } from "../_shared/http.ts";
import { requireAdmin } from "../_shared/supabase.ts";

type ColumnType = "ID" | "String" | "Int" | "Float" | "Boolean" | "Enum" | "DateTime";

type ReportSpec = {
  rpc: string;
  label: string;
  description: string;
  columns: ReadonlyArray<{ name: string; type: ColumnType }>;
  rowLimit: number;
  needsTarget: boolean;
};

const REPORTS: Record<string, ReportSpec> = {
  users: {
    rpc: "report_users",
    label: "User / Profile Report",
    description: "Registered users and their authored profile attributes.",
    rowLimit: 1000,
    needsTarget: false,
    columns: [
      { name: "userId", type: "ID" },
      { name: "username", type: "String" },
      { name: "role", type: "Enum" },
      { name: "status", type: "Enum" },
      { name: "displayName", type: "String" },
      { name: "age", type: "Int" },
      { name: "gender", type: "Enum" },
      { name: "maritalStatus", type: "Enum" },
      { name: "city", type: "String" },
      { name: "district", type: "String" },
      { name: "educationLabel", type: "String" },
      { name: "professionLabel", type: "String" },
      { name: "isPublic", type: "Boolean" },
      { name: "registeredAt", type: "DateTime" },
    ],
  },
  matchmaking: {
    rpc: "report_matchmaking",
    label: "Matchmaking Report",
    description:
      "Deterministic matchmaking output from the real matchmaking engine for the requesting admin's profile.",
    rowLimit: 50,
    needsTarget: false,
    columns: [
      { name: "profileId", type: "ID" },
      { name: "eligible", type: "Boolean" },
      { name: "overallScore", type: "Float" },
      { name: "interestsScore", type: "Float" },
      { name: "educationScore", type: "Float" },
      { name: "professionScore", type: "Float" },
      { name: "locationScore", type: "Float" },
      { name: "lifestyleScore", type: "Float" },
      { name: "preferenceScore", type: "Float" },
      { name: "modelVersion", type: "String" },
    ],
  },
  compatibility: {
    rpc: "report_compatibility",
    label: "Compatibility Report",
    description: "Deterministic compatibility breakdown from the real compatibility engine.",
    rowLimit: 1,
    needsTarget: true,
    columns: [
      { name: "targetProfileId", type: "ID" },
      { name: "eligible", type: "Boolean" },
      { name: "overallScore", type: "Float" },
      { name: "interestsScore", type: "Float" },
      { name: "educationScore", type: "Float" },
      { name: "professionScore", type: "Float" },
      { name: "educationProfessionScore", type: "Float" },
      { name: "locationScore", type: "Float" },
      { name: "lifestyleScore", type: "Float" },
      { name: "preferenceScore", type: "Float" },
      { name: "modelVersion", type: "String" },
      { name: "fromCache", type: "Boolean" },
    ],
  },
  ratings: {
    rpc: "report_ratings",
    label: "Ratings / Interaction Report",
    description: "Real rating records given by the requesting administrator.",
    rowLimit: 50,
    needsTarget: false,
    columns: [
      { name: "raterProfileId", type: "ID" },
      { name: "ratedProfileId", type: "ID" },
      { name: "score", type: "Int" },
      { name: "createdAt", type: "DateTime" },
    ],
  },
  "ratings-summary": {
    rpc: "report_ratings_summary",
    label: "Ratings Summary Report",
    description: "Aggregated rating summary for a rated profile from the real ratings engine.",
    rowLimit: 1,
    needsTarget: true,
    columns: [
      { name: "targetProfileId", type: "ID" },
      { name: "count", type: "Int" },
      { name: "average", type: "Float" },
      { name: "distribution", type: "String" },
    ],
  },
  admin: {
    rpc: "report_admin",
    label: "Administrative Report",
    description:
      "System-level aggregates over real application data (reference datasets and entity counts).",
    rowLimit: 13,
    needsTarget: false,
    columns: [
      { name: "metric", type: "String" },
      { name: "value", type: "Int" },
    ],
  },
};

/** RFC 4180 quoting: wrap in quotes, double any embedded quote. */
function csvCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  const text = typeof value === "object" ? JSON.stringify(value) : String(value);
  return `"${text.replace(/"/g, '""')}"`;
}

function toCsv(columns: ReadonlyArray<string>, rows: Array<Record<string, unknown>>): string {
  const lines = [columns.map(csvCell).join(",")];
  for (const row of rows) {
    lines.push(columns.map((column) => csvCell(row[column])).join(","));
  }
  return `${lines.join("\r\n")}\r\n`;
}

Deno.serve(
  handler(async (request) => {
    if (request.method !== "GET") {
      throw new HttpError(405, "METHOD_NOT_ALLOWED", "Use GET for this endpoint.");
    }

    const { client } = await requireAdmin(request);

    const url = new URL(request.url);
    const kind = url.searchParams.get("kind") ?? "";
    const format = url.searchParams.get("format") ?? "json";
    const targetProfileId = url.searchParams.get("targetProfileId");

    const spec = REPORTS[kind];
    if (!spec) {
      throw new HttpError(
        400,
        "VALIDATION_ERROR",
        `Unsupported report kind: ${kind}. Expected one of: ${Object.keys(REPORTS).join(", ")}.`,
      );
    }
    if (format !== "json" && format !== "csv") {
      throw new HttpError(400, "VALIDATION_ERROR", "format must be json or csv.");
    }
    if (spec.needsTarget && !targetProfileId) {
      throw new HttpError(
        400,
        "VALIDATION_ERROR",
        `The ${kind} report requires a targetProfileId.`,
      );
    }

    const args: Record<string, unknown> = {};
    if (spec.needsTarget) args.p_target = targetProfileId;

    const { data, error } = await client.rpc(spec.rpc, args);
    if (error) {
      // The SQL functions raise FORBIDDEN for a non-admin caller and
      // PROFILE_NOT_AVAILABLE when the target is not a public active profile.
      const message = error.message ?? "";
      if (message.includes("FORBIDDEN")) {
        throw new HttpError(403, "FORBIDDEN", "This report is restricted to administrators.");
      }
      if (message.includes("PROFILE_NOT_AVAILABLE")) {
        throw new HttpError(404, "NOT_FOUND", "The target profile is not available.");
      }
      console.error(`reports: ${kind} failed: ${message}`);
      throw new HttpError(500, "REPORT_FAILED", "The report could not be generated.");
    }

    const rows = (data ?? []) as Array<Record<string, unknown>>;
    const columnNames = spec.columns.map((column) => column.name);

    if (format === "csv") {
      return new Response(toCsv(columnNames, rows), {
        status: 200,
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": `attachment; filename="jibonjori-${kind}-${new Date().toISOString().slice(0, 10)}.csv"`,
        },
      });
    }

    return json(request, {
      dataset: {
        kind,
        label: spec.label,
        description: spec.description,
        columns: spec.columns,
        rowLimit: spec.rowLimit,
        rows,
      },
    });
  }),
);
