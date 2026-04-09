import { buildManualUsageReadModel } from "@/modules/manualUsage/readModel";
import type {
  ManualBillPeriodCompare as ManualMonthlyReconciliation,
  ManualBillPeriodCompareRow as ManualMonthlyReconciliationRow,
  ManualBillPeriodCompareStatus as ManualMonthlyReconciliationStatus,
} from "@/modules/manualUsage/readModel";
import type { ManualUsagePayload } from "@/modules/simulatedUsage/types";

export type { ManualMonthlyReconciliation, ManualMonthlyReconciliationRow, ManualMonthlyReconciliationStatus };

export function buildManualMonthlyReconciliation(args: {
  payload: ManualUsagePayload | null;
  dataset: any;
}): ManualMonthlyReconciliation | null {
  return buildManualUsageReadModel(args)?.billPeriodCompare ?? null;
}
