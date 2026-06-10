import type { ManualMonthlyReconciliation } from "@/modules/manualUsage/reconciliation";
import { isManualPastSimDisplayDataset } from "@/lib/usage/manualPastDisplayPolicy";

export function resolvePastCompareSectionMode(args: {
  manualMonthlyReconciliation?: ManualMonthlyReconciliation | null;
  datasetMeta?: Record<string, unknown> | null;
}): "statement_range_reconciliation" | "validation_compare" {
  if (!isManualPastSimDisplayDataset(args.datasetMeta)) {
    return "validation_compare";
  }
  return Array.isArray(args.manualMonthlyReconciliation?.rows) && args.manualMonthlyReconciliation.rows.length > 0
    ? "statement_range_reconciliation"
    : "validation_compare";
}
