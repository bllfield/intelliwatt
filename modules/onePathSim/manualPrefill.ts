import { rollingAutoAnchorEndDateChicago } from "@/modules/onePathSim/manualAnchor";
import { addDaysToIsoDate, buildContiguousStatementRanges, MAX_MANUAL_MONTHLY_BILLS } from "@/modules/onePathSim/manualStatementRanges";
import type {
  AnnualManualUsagePayload,
  ManualUsagePayload,
  MonthlyManualUsagePayload,
  TravelRange,
} from "@/modules/onePathSim/simulatedUsage/types";

type DailyUsageRow = { date?: string; kwh?: number };

export type ManualUsageStageOneSeedSourceMode =
  | "MONTHLY"
  | "ANNUAL"
  | "ACTUAL_INTERVALS_MONTHLY_PREFILL"
  | "ACTUAL_INTERVALS_ANNUAL_PREFILL"
  | null;

export type ManualUsageStageOnePayloadSource =
  | "test_home_saved_payload"
  | "source_payload"
  | "actual_derived_seed"
  | "unresolved";

export type ManualUsageStageOneResolvedSeeds = {
  anchorEndDate: string | null;
  usableSourceMonthlyPayload: MonthlyManualUsagePayload | null;
  usableSourceAnnualPayload: AnnualManualUsagePayload | null;
  monthlySeed: MonthlyManualUsagePayload | null;
  annualSeed: AnnualManualUsagePayload | null;
  sourceMode: ManualUsageStageOneSeedSourceMode;
};

export type ManualUsageStageOneResolvedPayload =
  | {
      mode: "MONTHLY";
      payload: MonthlyManualUsagePayload;
      payloadSource: Exclude<ManualUsageStageOnePayloadSource, "unresolved">;
      seedSet: ManualUsageStageOneResolvedSeeds;
    }
  | {
      mode: "ANNUAL";
      payload: AnnualManualUsagePayload;
      payloadSource: Exclude<ManualUsageStageOnePayloadSource, "unresolved">;
      seedSet: ManualUsageStageOneResolvedSeeds;
    }
  | {
      mode: "MONTHLY" | "ANNUAL";
      payload: null;
      payloadSource: "unresolved";
      seedSet: ManualUsageStageOneResolvedSeeds;
    };

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function isIsoDate(value: unknown): value is string {
  return typeof value === "string" && ISO_DATE_RE.test(value.trim());
}

function round2(value: number): number {
  return Math.round((Number(value) || 0) * 100) / 100;
}

function normalizeDailyRows(rows: unknown): Array<{ date: string; kwh: number }> {
  if (!Array.isArray(rows)) return [];
  return rows
    .map((row) => ({
      date: String((row as DailyUsageRow)?.date ?? "").slice(0, 10),
      kwh: Number((row as DailyUsageRow)?.kwh ?? Number.NaN),
    }))
    .filter((row) => isIsoDate(row.date) && Number.isFinite(row.kwh))
    .sort((a, b) => a.date.localeCompare(b.date));
}

function enumerateDateKeysInclusive(startDate: string, endDate: string): string[] {
  const start = new Date(`${startDate}T00:00:00.000Z`);
  const end = new Date(`${endDate}T00:00:00.000Z`);
  if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) || start > end) return [];
  const out: string[] = [];
  for (let cursor = start.getTime(); cursor <= end.getTime(); cursor += 24 * 60 * 60 * 1000) {
    out.push(new Date(cursor).toISOString().slice(0, 10));
  }
  return out;
}

export function hasUsableMonthlyPayload(payload: ManualUsagePayload | null | undefined): payload is MonthlyManualUsagePayload {
  return Boolean(
    payload &&
      payload.mode === "MONTHLY" &&
      isIsoDate(payload.anchorEndDate) &&
      Array.isArray(payload.monthlyKwh) &&
      payload.monthlyKwh.some((row) => typeof row?.kwh === "number" && Number.isFinite(row.kwh))
  );
}

export function hasUsableAnnualPayload(payload: ManualUsagePayload | null | undefined): payload is AnnualManualUsagePayload {
  return Boolean(
    payload &&
      payload.mode === "ANNUAL" &&
      isIsoDate(payload.anchorEndDate) &&
      typeof payload.annualKwh === "number" &&
      Number.isFinite(payload.annualKwh)
  );
}

export function resolveSeedAnchorEndDate(args: {
  sourcePayload: ManualUsagePayload | null;
  actualEndDate?: string | null;
}): string | null {
  const sourceAnchor =
    args.sourcePayload && isIsoDate((args.sourcePayload as any).anchorEndDate)
      ? String((args.sourcePayload as any).anchorEndDate).trim()
      : null;
  if (sourceAnchor) return sourceAnchor;
  return isIsoDate(args.actualEndDate) ? args.actualEndDate.trim() : null;
}

export function resolveGapfillSyntheticAnchorEndDate(_actualEndDate?: string | null, now = new Date()): string {
  return rollingAutoAnchorEndDateChicago(now, 2);
}

export function deriveMonthlySeedFromActual(args: {
  anchorEndDate: string;
  sourcePayload: ManualUsagePayload | null;
  travelRanges: TravelRange[];
  dailyRows: unknown;
}): MonthlyManualUsagePayload | null {
  if (hasUsableMonthlyPayload(args.sourcePayload)) {
    return {
      mode: "MONTHLY",
      anchorEndDate: args.sourcePayload.anchorEndDate,
      monthlyKwh: args.sourcePayload.monthlyKwh,
      statementRanges: args.sourcePayload.statementRanges,
      travelRanges: args.sourcePayload.travelRanges,
      dateSourceMode: args.sourcePayload.dateSourceMode,
    };
  }

  const normalizedDailyRows = normalizeDailyRows(args.dailyRows);
  if (normalizedDailyRows.length === 0 || !isIsoDate(args.anchorEndDate)) return null;
  const coverageStart = normalizedDailyRows[0]!.date;
  const coverageEnd = normalizedDailyRows[normalizedDailyRows.length - 1]!.date;
  const kwhByDate = new Map(normalizedDailyRows.map((row) => [row.date, row.kwh]));
  const seededRanges = buildContiguousStatementRanges(args.anchorEndDate, 12).filter(
    (range) => range.startDate != null && range.startDate >= coverageStart && range.endDate <= coverageEnd
  );
  if (seededRanges.length === 0) return null;

  const monthlyKwh = seededRanges.map((range) => ({
    month: range.month,
    kwh: round2(
      enumerateDateKeysInclusive(range.startDate ?? range.endDate, range.endDate).reduce(
        (sum, dateKey) => sum + (kwhByDate.get(dateKey) ?? 0),
        0
      )
    ),
  }));
  return {
    mode: "MONTHLY",
    anchorEndDate: seededRanges[0]!.endDate,
    monthlyKwh,
    statementRanges: seededRanges,
    travelRanges: args.travelRanges,
  };
}

export function deriveAnnualSeed(args: {
  anchorEndDate: string;
  sourcePayload: ManualUsagePayload | null;
  travelRanges: TravelRange[];
  dailyRows: unknown;
  monthlySeed?: MonthlyManualUsagePayload | null;
}): AnnualManualUsagePayload | null {
  if (hasUsableAnnualPayload(args.sourcePayload)) {
    return {
      mode: "ANNUAL",
      anchorEndDate: args.sourcePayload.anchorEndDate,
      annualKwh: args.sourcePayload.annualKwh,
      travelRanges: args.sourcePayload.travelRanges,
    };
  }
  if (hasUsableMonthlyPayload(args.sourcePayload)) {
    const annualKwh = round2(args.sourcePayload.monthlyKwh.reduce((sum, row) => sum + (typeof row.kwh === "number" ? row.kwh : 0), 0));
    return {
      mode: "ANNUAL",
      anchorEndDate: args.sourcePayload.anchorEndDate,
      annualKwh,
      travelRanges: args.sourcePayload.travelRanges,
    };
  }
  if (args.monthlySeed) {
    const annualKwh = round2(args.monthlySeed.monthlyKwh.reduce((sum, row) => sum + (typeof row.kwh === "number" ? row.kwh : 0), 0));
    return {
      mode: "ANNUAL",
      anchorEndDate: args.monthlySeed.anchorEndDate,
      annualKwh,
      travelRanges: args.travelRanges,
    };
  }

  const normalizedDailyRows = normalizeDailyRows(args.dailyRows);
  if (normalizedDailyRows.length === 0 || !isIsoDate(args.anchorEndDate)) return null;
  const annualKwh = round2(normalizedDailyRows.reduce((sum, row) => sum + row.kwh, 0));
  return {
    mode: "ANNUAL",
    anchorEndDate: args.anchorEndDate,
    annualKwh,
    travelRanges: args.travelRanges,
  };
}

export function buildManualUsageStageOneResolvedSeeds(args: {
  sourcePayload: ManualUsagePayload | null;
  actualEndDate?: string | null;
  travelRanges: TravelRange[];
  dailyRows: unknown;
}): ManualUsageStageOneResolvedSeeds {
  const usableSourceMonthlyPayload = hasUsableMonthlyPayload(args.sourcePayload)
    ? {
        mode: "MONTHLY" as const,
        anchorEndDate: args.sourcePayload.anchorEndDate,
        monthlyKwh: args.sourcePayload.monthlyKwh,
        statementRanges: args.sourcePayload.statementRanges,
        travelRanges: args.sourcePayload.travelRanges,
        dateSourceMode: args.sourcePayload.dateSourceMode,
      }
    : null;
  const usableSourceAnnualPayload = hasUsableAnnualPayload(args.sourcePayload)
    ? {
        mode: "ANNUAL" as const,
        anchorEndDate: args.sourcePayload.anchorEndDate,
        annualKwh: args.sourcePayload.annualKwh,
        travelRanges: args.sourcePayload.travelRanges,
      }
    : null;
  const anchorEndDate = resolveSeedAnchorEndDate({
    sourcePayload: args.sourcePayload,
    actualEndDate: args.actualEndDate,
  });
  const monthlySeed =
    anchorEndDate && !usableSourceMonthlyPayload
      ? deriveMonthlySeedFromActual({
          anchorEndDate,
          sourcePayload: args.sourcePayload,
          travelRanges: args.travelRanges,
          dailyRows: args.dailyRows,
        })
      : null;
  const annualSeed =
    anchorEndDate && !usableSourceAnnualPayload
      ? deriveAnnualSeed({
          anchorEndDate,
          sourcePayload: args.sourcePayload,
          travelRanges: args.travelRanges,
          dailyRows: args.dailyRows,
          monthlySeed,
        })
      : null;
  const sourceMode: ManualUsageStageOneSeedSourceMode =
    usableSourceMonthlyPayload?.mode ??
    usableSourceAnnualPayload?.mode ??
    (monthlySeed ? "ACTUAL_INTERVALS_MONTHLY_PREFILL" : annualSeed ? "ACTUAL_INTERVALS_ANNUAL_PREFILL" : null);
  return {
    anchorEndDate,
    usableSourceMonthlyPayload,
    usableSourceAnnualPayload,
    monthlySeed,
    annualSeed,
    sourceMode,
  };
}

export function resolveManualUsageStageOnePayloadForMode(args: {
  mode: "MONTHLY" | "ANNUAL";
  testHomePayload?: ManualUsagePayload | null;
  seedSet: ManualUsageStageOneResolvedSeeds;
}): ManualUsageStageOneResolvedPayload {
  if (args.mode === "MONTHLY") {
    if (hasUsableMonthlyPayload(args.testHomePayload)) {
      return {
        mode: "MONTHLY",
        payload: {
          mode: "MONTHLY",
          anchorEndDate: args.testHomePayload.anchorEndDate,
          monthlyKwh: args.testHomePayload.monthlyKwh,
          statementRanges: args.testHomePayload.statementRanges,
          travelRanges: args.testHomePayload.travelRanges,
          dateSourceMode: args.testHomePayload.dateSourceMode,
        },
        payloadSource: "test_home_saved_payload",
        seedSet: args.seedSet,
      };
    }
    if (args.seedSet.usableSourceMonthlyPayload) {
      return {
        mode: "MONTHLY",
        payload: args.seedSet.usableSourceMonthlyPayload,
        payloadSource: "source_payload",
        seedSet: args.seedSet,
      };
    }
    if (args.seedSet.monthlySeed) {
      return {
        mode: "MONTHLY",
        payload: args.seedSet.monthlySeed,
        payloadSource: "actual_derived_seed",
        seedSet: args.seedSet,
      };
    }
  } else {
    if (hasUsableAnnualPayload(args.testHomePayload)) {
      return {
        mode: "ANNUAL",
        payload: {
          mode: "ANNUAL",
          anchorEndDate: args.testHomePayload.anchorEndDate,
          annualKwh: args.testHomePayload.annualKwh,
          travelRanges: args.testHomePayload.travelRanges,
        },
        payloadSource: "test_home_saved_payload",
        seedSet: args.seedSet,
      };
    }
    if (args.seedSet.usableSourceAnnualPayload) {
      return {
        mode: "ANNUAL",
        payload: args.seedSet.usableSourceAnnualPayload,
        payloadSource: "source_payload",
        seedSet: args.seedSet,
      };
    }
    if (args.seedSet.annualSeed) {
      return {
        mode: "ANNUAL",
        payload: args.seedSet.annualSeed,
        payloadSource: "actual_derived_seed",
        seedSet: args.seedSet,
      };
    }
  }
  return {
    mode: args.mode,
    payload: null,
    payloadSource: "unresolved",
    seedSet: args.seedSet,
  };
}

export function resolveSharedManualStageOneContract(args: {
  mode: "MONTHLY" | "ANNUAL";
  sourcePayload: ManualUsagePayload | null;
  testHomePayload?: ManualUsagePayload | null;
  actualEndDate?: string | null;
  travelRanges: TravelRange[];
  dailyRows: unknown;
}): ManualUsageStageOneResolvedPayload {
  const seedSet = buildManualUsageStageOneResolvedSeeds({
    sourcePayload: args.sourcePayload,
    actualEndDate: args.actualEndDate,
    travelRanges: args.travelRanges,
    dailyRows: args.dailyRows,
  });
  return resolveManualUsageStageOnePayloadForMode({
    mode: args.mode,
    testHomePayload: args.testHomePayload ?? null,
    seedSet,
  });
}

export function reanchorGapfillManualStageOnePayload(args: {
  payload: MonthlyManualUsagePayload;
  anchorEndDate: string;
}): MonthlyManualUsagePayload;
export function reanchorGapfillManualStageOnePayload(args: {
  payload: AnnualManualUsagePayload;
  anchorEndDate: string;
}): AnnualManualUsagePayload;
export function reanchorGapfillManualStageOnePayload(args: {
  payload: MonthlyManualUsagePayload | AnnualManualUsagePayload;
  anchorEndDate: string;
}): MonthlyManualUsagePayload | AnnualManualUsagePayload {
  if (!isIsoDate(args.anchorEndDate)) return args.payload;
  if (args.payload.mode === "ANNUAL") {
    return {
      ...args.payload,
      anchorEndDate: args.anchorEndDate,
    };
  }
  const monthlyPayload = args.payload as MonthlyManualUsagePayload;
  const statementRanges = buildContiguousStatementRanges(args.anchorEndDate, MAX_MANUAL_MONTHLY_BILLS);
  const monthlyKwh: MonthlyManualUsagePayload["monthlyKwh"] = statementRanges.map((range, index) => {
    const rawKwh = monthlyPayload.monthlyKwh?.[index]?.kwh;
    return {
      month: range.month,
      kwh: typeof rawKwh === "number" && Number.isFinite(rawKwh) ? rawKwh : ("" as const),
    };
  });
  return {
    ...monthlyPayload,
    anchorEndDate: args.anchorEndDate,
    monthlyKwh,
    statementRanges,
  };
}

