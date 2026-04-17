import type { UserUsageHouseContract } from "@/lib/usage/userUsageHouseContract";

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function asArray<T = unknown>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

function pickNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function round2(value: number): number {
  return Math.round((Number(value) || 0) * 100) / 100;
}

function approxEqual(left: number | null, right: number | null, tolerance = 0.05): boolean | null {
  if (left == null || right == null) return null;
  return Math.abs(left - right) <= tolerance;
}

function sumRows(rows: unknown, key: string): number | null {
  const values = asArray<Record<string, unknown>>(rows)
    .map((row) => pickNumber(row[key]))
    .filter((value): value is number => value != null);
  if (!values.length) return null;
  return round2(values.reduce((sum, value) => sum + value, 0));
}

export type OnePathBaselineParityAudit = {
  userSiteBaselineOwnerUsed: string;
  onePathBaselineOwnerUsed: string;
  parityStatus:
    | "matched_shared_baseline_truth"
    | "missing_shared_baseline_truth"
    | "summary_mismatch_detected";
  intervalCountParity: boolean | null;
  totalKwhParity: boolean | null;
  monthlyParity: boolean | null;
  dailyParity: boolean | null;
  lookupIntervalsCount: number | null;
  readModelIntervalsCount: number | null;
  lookupTotalKwh: number | null;
  readModelTotalKwh: number | null;
  readModelMonthlyTotalKwh: number | null;
  readModelDailyTotalKwh: number | null;
};

export function buildOnePathBaselineParityAudit(args: {
  houseContract?: UserUsageHouseContract | null;
  lookupActualDatasetSummary?: unknown;
  readModel?: unknown;
}): OnePathBaselineParityAudit {
  const houseContract = (args.houseContract ?? null) as UserUsageHouseContract | null;
  const lookupSummary = asRecord(args.lookupActualDatasetSummary);
  const readModel = asRecord(args.readModel);
  const dataset = Object.keys(asRecord(houseContract?.dataset)).length
    ? asRecord(houseContract?.dataset)
    : asRecord(readModel.dataset);
  const datasetSummary = asRecord(dataset.summary);
  const lookupIntervalsCount = pickNumber(lookupSummary.intervalsCount) ?? pickNumber(datasetSummary.intervalsCount);
  const readModelIntervalsCount = pickNumber(datasetSummary.intervalsCount);
  const lookupTotalKwh = pickNumber(lookupSummary.totalKwh) ?? pickNumber(datasetSummary.totalKwh);
  const readModelTotalKwh = pickNumber(datasetSummary.totalKwh);
  const readModelMonthlyTotalKwh = sumRows(dataset.monthly, "kwh");
  const readModelDailyTotalKwh = sumRows(dataset.daily, "kwh");
  const intervalCountParity =
    lookupIntervalsCount == null || readModelIntervalsCount == null ? null : lookupIntervalsCount === readModelIntervalsCount;
  const totalKwhParity = approxEqual(lookupTotalKwh, readModelTotalKwh);
  const monthlyParity = approxEqual(readModelTotalKwh, readModelMonthlyTotalKwh);
  const dailyParity = approxEqual(readModelTotalKwh, readModelDailyTotalKwh);

  const parityStatus =
    readModelTotalKwh == null
      ? "missing_shared_baseline_truth"
      : intervalCountParity !== false && totalKwhParity !== false && monthlyParity !== false && dailyParity !== false
        ? "matched_shared_baseline_truth"
        : "summary_mismatch_detected";

  return {
    userSiteBaselineOwnerUsed: "lib/usage/userUsageHouseContract.ts -> buildUserUsageHouseContract",
    onePathBaselineOwnerUsed: "lib/usage/userUsageHouseContract.ts -> buildUserUsageHouseContract",
    parityStatus,
    intervalCountParity,
    totalKwhParity,
    monthlyParity,
    dailyParity,
    lookupIntervalsCount,
    readModelIntervalsCount,
    lookupTotalKwh,
    readModelTotalKwh,
    readModelMonthlyTotalKwh,
    readModelDailyTotalKwh,
  };
}
