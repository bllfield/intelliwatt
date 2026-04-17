import type { UserUsageHouseContract } from "@/lib/usage/userUsageHouseContract";
import { buildUserUsageDashboardViewModel } from "@/lib/usage/userUsageDashboardViewModel";
import { buildWeekdayWeekendBreakdownNote } from "@/components/usage/readoutTruth";

type BaselineParityFieldKey =
  | "source"
  | "coverageStart"
  | "coverageEnd"
  | "intervalCount"
  | "totals"
  | "headlineTotal"
  | "baseloadFields"
  | "weatherScore"
  | "monthlyRows"
  | "dailyRowCount"
  | "fifteenMinuteCurve"
  | "weekdayWeekend"
  | "timeOfDayBuckets"
  | "breakdownNote"
  | "weatherBasisLabel";

type BaselineParityField = {
  matched: boolean;
  userValue: unknown;
  onePathValue: unknown;
};

function approxEqual(left: number | null | undefined, right: number | null | undefined, tolerance = 0.05): boolean {
  if (left == null && right == null) return true;
  if (left == null || right == null) return false;
  return Math.abs(left - right) <= tolerance;
}

function stableStringify(value: unknown): string {
  return JSON.stringify(value, (_key, nestedValue) => {
    if (nestedValue && typeof nestedValue === "object" && !Array.isArray(nestedValue)) {
      return Object.fromEntries(Object.entries(nestedValue as Record<string, unknown>).sort(([left], [right]) => left.localeCompare(right)));
    }
    return nestedValue;
  });
}

function valuesMatch(left: unknown, right: unknown): boolean {
  if (typeof left === "number" || typeof right === "number") {
    return approxEqual(typeof left === "number" ? left : null, typeof right === "number" ? right : null);
  }
  return stableStringify(left) === stableStringify(right);
}

export function buildBaselineParityReport(args: {
  userUsagePageContract?: UserUsageHouseContract | null;
  onePathBaselineContract?: UserUsageHouseContract | null;
}): {
  overallMatch: boolean;
  firstDivergenceField: BaselineParityFieldKey | null;
  matchedKeys: BaselineParityFieldKey[];
  mismatchedKeys: BaselineParityFieldKey[];
  fields: Record<BaselineParityFieldKey, BaselineParityField>;
} {
  const userView = buildUserUsageDashboardViewModel(args.userUsagePageContract ?? null);
  const onePathView = buildUserUsageDashboardViewModel(args.onePathBaselineContract ?? null);

  const userWeather = args.userUsagePageContract?.weatherSensitivityScore ?? null;
  const onePathWeather = args.onePathBaselineContract?.weatherSensitivityScore ?? null;

  const fieldEntries: Array<[BaselineParityFieldKey, unknown, unknown]> = [
    ["source", userView?.coverage.source ?? null, onePathView?.coverage.source ?? null],
    ["coverageStart", userView?.coverage.start ?? null, onePathView?.coverage.start ?? null],
    ["coverageEnd", userView?.coverage.end ?? null, onePathView?.coverage.end ?? null],
    ["intervalCount", userView?.coverage.intervalsCount ?? null, onePathView?.coverage.intervalsCount ?? null],
    ["totals", userView?.derived.totals ?? null, onePathView?.derived.totals ?? null],
    ["headlineTotal", userView?.derived.totalKwh ?? null, onePathView?.derived.totalKwh ?? null],
    [
      "baseloadFields",
      {
        baseload: userView?.derived.baseload ?? null,
        baseloadDaily: userView?.derived.baseloadDaily ?? null,
        baseloadMonthly: userView?.derived.baseloadMonthly ?? null,
      },
      {
        baseload: onePathView?.derived.baseload ?? null,
        baseloadDaily: onePathView?.derived.baseloadDaily ?? null,
        baseloadMonthly: onePathView?.derived.baseloadMonthly ?? null,
      },
    ],
    [
      "weatherScore",
      userWeather
        ? {
            weatherEfficiencyScore0to100: userWeather.weatherEfficiencyScore0to100,
            explanationSummary: userWeather.explanationSummary,
            scoringMode: userWeather.scoringMode,
          }
        : null,
      onePathWeather
        ? {
            weatherEfficiencyScore0to100: onePathWeather.weatherEfficiencyScore0to100,
            explanationSummary: onePathWeather.explanationSummary,
            scoringMode: onePathWeather.scoringMode,
          }
        : null,
    ],
    ["monthlyRows", userView?.derived.monthly ?? null, onePathView?.derived.monthly ?? null],
    ["dailyRowCount", userView?.derived.daily.length ?? 0, onePathView?.derived.daily.length ?? 0],
    [
      "fifteenMinuteCurve",
      {
        present: Boolean(userView?.derived.fifteenCurve.length),
        points: userView?.derived.fifteenCurve.length ?? 0,
      },
      {
        present: Boolean(onePathView?.derived.fifteenCurve.length),
        points: onePathView?.derived.fifteenCurve.length ?? 0,
      },
    ],
    [
      "weekdayWeekend",
      {
        weekdayKwh: userView?.derived.weekdayKwh ?? null,
        weekendKwh: userView?.derived.weekendKwh ?? null,
      },
      {
        weekdayKwh: onePathView?.derived.weekdayKwh ?? null,
        weekendKwh: onePathView?.derived.weekendKwh ?? null,
      },
    ],
    ["timeOfDayBuckets", userView?.derived.timeOfDayBuckets ?? null, onePathView?.derived.timeOfDayBuckets ?? null],
    [
      "breakdownNote",
      buildWeekdayWeekendBreakdownNote({
        weekdayKwh: userView?.derived.weekdayKwh ?? 0,
        weekendKwh: userView?.derived.weekendKwh ?? 0,
        summaryTotalKwh: userView?.derived.totalKwh ?? null,
      }),
      buildWeekdayWeekendBreakdownNote({
        weekdayKwh: onePathView?.derived.weekdayKwh ?? 0,
        weekendKwh: onePathView?.derived.weekendKwh ?? 0,
        summaryTotalKwh: onePathView?.derived.totalKwh ?? null,
      }),
    ],
    ["weatherBasisLabel", userView?.coverage.weatherBasisLabel ?? null, onePathView?.coverage.weatherBasisLabel ?? null],
  ];

  const fields = Object.fromEntries(
    fieldEntries.map(([key, userValue, onePathValue]) => [
      key,
      {
        matched: valuesMatch(userValue, onePathValue),
        userValue,
        onePathValue,
      },
    ])
  ) as Record<BaselineParityFieldKey, BaselineParityField>;

  const orderedKeys = fieldEntries.map(([key]) => key);
  const mismatchedKeys = orderedKeys.filter((key) => !fields[key].matched);
  const matchedKeys = orderedKeys.filter((key) => fields[key].matched);

  return {
    overallMatch: mismatchedKeys.length === 0,
    firstDivergenceField: mismatchedKeys[0] ?? null,
    matchedKeys,
    mismatchedKeys,
    fields,
  };
}
