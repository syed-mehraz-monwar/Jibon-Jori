import { invokeFunction } from "../lib/supabase";
import type { ReportDataset, ReportKind } from "../lib/types";

/**
 * `/api/reports` — admin only (`requireAdmin` inside the `reports` Edge Function).
 *
 * Datasets carry a real `rowLimit` so the UI can state whether it is showing a
 * complete dataset or a bounded one (§17). The function reads every row from a
 * `report_*` SQL function; no demo data is ever synthesised.
 */
export const reportsApi = {
  dataset: async (
    kind: ReportKind,
    targetProfileId?: string,
    _signal?: AbortSignal
  ): Promise<{ dataset: ReportDataset }> => {
    const query = new URLSearchParams({ kind, format: "json" });
    if (targetProfileId) query.set("targetProfileId", targetProfileId);
    return invokeFunction<{ dataset: ReportDataset }>("reports", undefined, `?${query.toString()}`, "GET");
  },
};
