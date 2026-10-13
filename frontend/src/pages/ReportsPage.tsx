import { useState } from "react";
import { reportsApi } from "../api/reports.api";
import { useAuth } from "../context/AuthContext";
import { useAsync } from "../hooks/useAsync";
import { formatDateTime } from "../lib/format";
import type { ReportKind } from "../lib/types";
import { PageHeader } from "../components/layout/PageHeader";
import { Badge } from "../components/ui/Badge";
import { Card } from "../components/ui/Card";
import { EmptyState } from "../components/ui/EmptyState";
import { ErrorState } from "../components/ui/ErrorState";
import { Field } from "../components/ui/Field";
import { Input } from "../components/ui/Input";
import { Select } from "../components/ui/Select";
import { Spinner } from "../components/ui/Spinner";

const KINDS: { value: ReportKind; label: string }[] = [
  { value: "admin", label: "Administrative summary" },
  { value: "users", label: "Users" },
  { value: "matchmaking", label: "Matchmaking" },
  { value: "compatibility", label: "Compatibility (needs a profile id)" },
  { value: "ratings", label: "Ratings" },
  { value: "ratings-summary", label: "Ratings summary (needs a profile id)" },
];

function renderCell(value: unknown): string {
  if (value === null || value === undefined) return "-";
  if (typeof value === "boolean") return value ? "yes" : "no";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

/**
 * Administrative report datasets (Spec §19 / Crystal Reports).
 *
 * The API returns structured datasets (columns + rows + `rowLimit`) that the
 * Crystal Reports binding consumes. This page renders the same data for on-screen
 * review and states the row limit, so a bounded dataset can be told apart from a
 * complete one. It reads only real backend data; nothing is mocked.
 */
export function ReportsPage() {
  const { isAdmin } = useAuth();
  const [kind, setKind] = useState<ReportKind>("admin");
  const [targetProfileId, setTargetProfileId] = useState("");

  const needsTarget = kind === "compatibility" || kind === "ratings-summary";

  const report = useAsync(
    (signal) => reportsApi.dataset(kind, needsTarget ? targetProfileId : undefined, signal),
    [kind, targetProfileId, needsTarget],
    { enabled: isAdmin && (!needsTarget || targetProfileId.length > 0) }
  );

  if (!isAdmin) {
    return (
      <>
        <PageHeader title="Reports" />
        <EmptyState
          title="Administrators only"
          description="This section requires the administrator role. The API enforces this independently of the UI."
        />
      </>
    );
  }

  const dataset = report.data?.dataset;

  return (
    <>
      <PageHeader
        title="Reports"
        description="Report datasets exposed for the Crystal Reports binding. Data is read from the live database."
      />

      <Card className="mb-5">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Report" htmlFor="report-kind">
            <Select
              id="report-kind"
              value={kind}
              onChange={(event) => setKind(event.target.value as ReportKind)}
              options={KINDS}
            />
          </Field>
          {needsTarget ? (
            <Field label="Target profile id" htmlFor="report-target" required hint="A UUID.">
              <Input
                id="report-target"
                value={targetProfileId}
                onChange={(event) => setTargetProfileId(event.target.value.trim())}
                placeholder="9c1f0a2e-..."
              />
            </Field>
          ) : null}
        </div>
      </Card>

      {report.status === "idle" ? (
        <EmptyState title="Choose a report" description="Select a dataset above to load it." />
      ) : report.status === "loading" ? (
        <div className="flex justify-center py-16">
          <Spinner className="h-8 w-8 text-brand-600" />
        </div>
      ) : report.status === "error" ? (
        <ErrorState error={report.error} onRetry={report.reload} />
      ) : dataset ? (
        <Card
          title={dataset.label}
          actions={
            <div className="flex items-center gap-2">
              <Badge tone={dataset.rows.length >= dataset.rowLimit ? "warning" : "success"}>
                {dataset.rows.length >= dataset.rowLimit ? `capped at ${dataset.rowLimit}` : `${dataset.rows.length} rows`}
              </Badge>
              <span className="text-xs text-slate-400">{formatDateTime(new Date().toISOString())}</span>
            </div>
          }
        >
          <p className="mb-4 text-sm text-slate-600">{dataset.description}</p>

          {dataset.rows.length === 0 ? (
            <EmptyState title="No rows" description="The dataset is empty for the current selection." />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[36rem] border-collapse text-sm">
                <caption className="sr-only">{dataset.label}</caption>
                <thead>
                  <tr className="border-b border-slate-200 text-left">
                    {dataset.columns.map((column) => (
                      <th key={column.name} scope="col" className="px-2 py-2 font-semibold text-slate-700">
                        {column.name}
                        <span className="ml-1 text-xs font-normal text-slate-400">{column.type}</span>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {dataset.rows.map((row, index) => (
                    <tr key={index} className="border-b border-slate-100">
                      {dataset.columns.map((column) => (
                        <td key={column.name} className="px-2 py-2 text-slate-700">
                          {renderCell(row[column.name])}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      ) : null}
    </>
  );
}
