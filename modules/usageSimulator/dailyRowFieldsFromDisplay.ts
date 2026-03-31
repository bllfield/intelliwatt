import type { PastSimulatedDaySourceDetail } from "@/modules/usageSimulator/dataset";

/** Matches `DailyRow["sourceDetail"]` in UsageDashboard (display-only). */
export type UsageDailyDisplaySourceDetail =
  | PastSimulatedDaySourceDetail
  | "ACTUAL"
  | "ACTUAL_VALIDATION_TEST_DAY";

/**
 * Normalizes date/kwh/source/sourceDetail for Usage derived daily rows (chart + table).
 * Shared with tests so Vitest does not need to parse TSX from UsageDashboard.
 */
export function dailyRowFieldsFromSourceRow(row: {
  date: string;
  kwh: unknown;
  source?: string;
  sourceDetail?: string;
}): {
  date: string;
  kwh: number;
  source?: "ACTUAL" | "SIMULATED";
  sourceDetail?: UsageDailyDisplaySourceDetail;
} {
  const src = String(row?.source ?? "").toUpperCase();
  return {
    date: String(row.date).slice(0, 10),
    kwh: Number(row.kwh) || 0,
    ...(src === "SIMULATED" ? { source: "SIMULATED" as const } : {}),
    ...(src === "ACTUAL" ? { source: "ACTUAL" as const } : {}),
    ...(typeof row?.sourceDetail === "string"
      ? { sourceDetail: String(row.sourceDetail) as UsageDailyDisplaySourceDetail }
      : {}),
  };
}
