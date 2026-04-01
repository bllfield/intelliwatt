import type { ManualMonthlyReconciliation } from "@/modules/manualUsage/reconciliation";

export function resolvePastCompareSectionMode(args: {
  manualMonthlyReconciliation?: ManualMonthlyReconciliation | null;
}): "statement_range_reconciliation" | "validation_compare" {
  return Array.isArray(args.manualMonthlyReconciliation?.rows) && args.manualMonthlyReconciliation.rows.length > 0
    ? "statement_range_reconciliation"
    : "validation_compare";
}
