import type { PlanRules, RateStructure } from "./planEngine";
import { computePlanCost } from "@/lib/planAnalyzer/planCostEngine";
import type {
  IntervalUsagePoint,
  RatePlanRef,
} from "@/lib/planAnalyzer/planTypes";

export type EflAvgPriceValidationStatus = "PASS" | "FAIL" | "SKIP";

export type EflAvgPricePoint = {
  kwh: 500 | 1000 | 2000;
  eflAvgCentsPerKwh: number;
};

export interface EflAvgPriceValidation {
  status: EflAvgPriceValidationStatus;
  toleranceCentsPerKwh: number;
  points: Array<{
    usageKwh: number;
    expectedAvgCentsPerKwh: number;
    modeledAvgCentsPerKwh: number | null;
    diffCentsPerKwh: number | null;
    ok: boolean;
  }>;
  assumptionsUsed: {
    nightUsagePercent?: number;
    nightStartHour?: number;
    nightEndHour?: number;
    tdspIncludedInEnergyCharge?: boolean;
  };
  fail: boolean;
  queueReason?: string;
  notes?: string[];
  avgTableFound: boolean;
  avgTableRows?: Array<{ kwh: number; avgPriceCentsPerKwh: number }>;
  avgTableSnippet?: string;
}

const DEFAULT_TOLERANCE_CENTS_PER_KWH = 0.25;
const VALIDATION_TZ = "America/Chicago";

// -------------------- Assumption-based detection --------------------

export function isAssumptionBasedAvgPriceTable(rawText: string): {
  isAssumptionBased: boolean;
  reason?: string;
} {
  const t = rawText.toLowerCase();

  const patterns = [
    /this price disclosure is based on .*estimated/i,
    /we have assumed/i,
    /assumed .*%/i,
    /estimated .*%/i,
    /consumption during night hours/i,
    /night hours\s*=\s*\d{1,2}:\d{2}\s*(am|pm)\s*[–-]\s*\d{1,2}:\d{2}\s*(am|pm)/i,
  ];

  for (const p of patterns) {
    if (p.test(rawText)) {
      return {
        isAssumptionBased: true,
        reason:
          "EFL average price table appears assumption-based (e.g., estimated night-hours split).",
      };
    }
  }

  if (
    t.includes("example based on average prices") &&
    (t.includes("night hours") || t.includes("free"))
  ) {
    return {
      isAssumptionBased: true,
      reason:
        "EFL average price table is an example and references free/night hours; skipping strict validation.",
    };
  }

  return { isAssumptionBased: false };
}

// -------------------- Avg price table extraction --------------------

function extractLineAfterLabel(
  rawText: string,
  labelRegex: RegExp,
): string | null {
  const lines = rawText.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    if (labelRegex.test(lines[i])) {
      const cur = lines[i] ?? "";
      const next = lines[i + 1] ?? "";
      return (cur + " " + next).trim();
    }
  }
  return null;
}

export function extractEflAvgPricePoints(
  rawText: string,
): EflAvgPricePoint[] | null {
  // Support common encodings like "18.5¢", "18.5 ¢", and "18.5Â¢"
  // by allowing arbitrary non-digit, non-¢ chars between the number
  // and the literal cent sign.
  const centsPattern = /(\d+(?:\.\d+)?)[^\d¢]*¢/g;

  const useLine =
    extractLineAfterLabel(rawText, /Average\s+(monthly\s+)?use/i) ?? "";
  const priceLine =
    extractLineAfterLabel(
      rawText,
      /Average\s+price\s+(per\s+kilowatt-hour|per\s+kwh|per\s+kwh:?|per\s+kilo?watt-hour)/i,
    ) ?? "";

  const uses = Array.from(
    useLine.matchAll(/(\d{1,2}(?:,\d{3})?)\s*kwh/gi),
  ).map((m) => Number(m[1].replace(/,/g, "")));
  const hasRequiredUses =
    uses.includes(500) && uses.includes(1000) && uses.includes(2000);

  const centsTokens = Array.from(priceLine.matchAll(centsPattern)).map((m) =>
    Number(m[1]),
  );
  const has3 = centsTokens.length >= 3;

  if (!hasRequiredUses || !has3) {
    const tableScan = rawText.replace(/\r/g, "");
    const useMatch = tableScan.match(
      /Average\s+(Monthly\s+Use|monthly\s+use)[^\n]*\n?[^\n]*/i,
    );
    const priceMatch = tableScan.match(
      /Average\s+price[^\n]*\n?[^\n]*/i,
    );

    const useText = useMatch?.[0] ?? useLine;
    const priceText = priceMatch?.[0] ?? priceLine;

    const uses2 = Array.from(
      useText.matchAll(/(\d{1,2}(?:,\d{3})?)\s*kwh/gi),
    ).map((m) => Number(m[1].replace(/,/g, "")));
    const cents2 = Array.from(priceText.matchAll(centsPattern)).map((m) =>
      Number(m[1]),
    );

    if (
      !(
        uses2.includes(500) &&
        uses2.includes(1000) &&
        uses2.includes(2000)
      ) ||
      cents2.length < 3
    ) {
      return null;
    }

    return [
      { kwh: 500, eflAvgCentsPerKwh: cents2[0] },
      { kwh: 1000, eflAvgCentsPerKwh: cents2[1] },
      { kwh: 2000, eflAvgCentsPerKwh: cents2[2] },
    ];
  }

  return [
    { kwh: 500, eflAvgCentsPerKwh: centsTokens[0] },
    { kwh: 1000, eflAvgCentsPerKwh: centsTokens[1] },
    { kwh: 2000, eflAvgCentsPerKwh: centsTokens[2] },
  ];
}

// -------------------- Night hours assumption parsing --------------------

export function parseEflNightHoursAssumption(rawText: string): {
  nightStartHour?: number;
  nightEndHour?: number;
  nightUsagePercent?: number;
} | null {
  const percentMatch = rawText.match(
    /estimated\s+(\d{1,3})%\s+consumption\s+during\s+night\s+hours/i,
  );
  const nightUsagePercent =
    percentMatch && percentMatch[1]
      ? Number(percentMatch[1]) / 100
      : undefined;

  const hoursMatch =
    rawText.match(
      /Night\s*Hours\s*=\s*([0-9]{1,2})\s*:\s*([0-9]{2})\s*(AM|PM)\s*[–-]\s*([0-9]{1,2})\s*:\s*([0-9]{2})\s*(AM|PM)/i,
    ) ?? null;

  const to24 = (hh: string, mm: string, ap: string): number | null => {
    let h = Number(hh);
    const minute = Number(mm);
    if (!Number.isFinite(h) || !Number.isFinite(minute)) return null;
    const isPm = ap.toUpperCase() === "PM";
    if (h === 12) {
      h = isPm ? 12 : 0;
    } else {
      h = isPm ? h + 12 : h;
    }
    return h;
  };

  let nightStartHour: number | undefined;
  let nightEndHour: number | undefined;
  if (hoursMatch) {
    const start = to24(hoursMatch[1], hoursMatch[2], hoursMatch[3]);
    const end = to24(hoursMatch[4], hoursMatch[5], hoursMatch[6]);
    if (start != null && end != null) {
      nightStartHour = start;
      nightEndHour = end;
    }
  }

  if (
    nightUsagePercent === undefined &&
    nightStartHour === undefined &&
    nightEndHour === undefined
  ) {
    return null;
  }

  return { nightUsagePercent, nightStartHour, nightEndHour };
}

// -------------------- Canonical calculator adapter --------------------

async function computeModeledAvgCentsPerKwhOrNull(args: {
  planRules: PlanRules;
  rateStructure: RateStructure | null;
  kwh: number;
  nightUsagePercent?: number;
  nightStartHour?: number;
  nightEndHour?: number;
}): Promise<number | null> {
  const { planRules, kwh } = args;

  if (!planRules) return null;
  if (kwh <= 0) return null;

  const usage: IntervalUsagePoint[] = [];

  const baseDate = "2025-01-15";

  const buildTimestamp = (hour: number): string =>
    `${baseDate}T${String(hour).padStart(2, "0")}:00:00-06:00`;

  const nightPercent = args.nightUsagePercent;
  const hasNightWindow =
    typeof args.nightStartHour === "number" &&
    typeof args.nightEndHour === "number";

  // Simple uniform usage across 24 hours when no explicit night-hours
  // assumption is available or plan is not clearly TOU with free nights.
  const isTouFreeNights =
    Array.isArray((planRules as any).timeOfUsePeriods) &&
    (planRules as any).timeOfUsePeriods.some(
      (p: any) => p && p.isFree === true,
    );

  if (!isTouFreeNights || nightPercent == null || !hasNightWindow) {
    const perHour = kwh / 24;
    for (let h = 0; h < 24; h++) {
      usage.push({
        timestamp: buildTimestamp(h),
        kwhImport: perHour,
        kwhExport: 0,
      });
    }
  } else {
    const nightStart = args.nightStartHour!;
    const nightEnd = args.nightEndHour!;

    const isNight = (h: number): boolean => {
      if (nightStart < nightEnd) {
        return h >= nightStart && h < nightEnd;
      }
      // crosses midnight
      return h >= nightStart || h < nightEnd;
    };

    const nightHours: number[] = [];
    const dayHours: number[] = [];
    for (let h = 0; h < 24; h++) {
      if (isNight(h)) nightHours.push(h);
      else dayHours.push(h);
    }

    if (nightHours.length === 0 || dayHours.length === 0) {
      const perHour = kwh / 24;
      for (let h = 0; h < 24; h++) {
        usage.push({
          timestamp: buildTimestamp(h),
          kwhImport: perHour,
          kwhExport: 0,
        });
      }
    } else {
      const nightKwh = kwh * nightPercent;
      const dayKwh = kwh - nightKwh;
      const perNight = nightKwh / nightHours.length;
      const perDay = dayKwh / dayHours.length;

      for (let h = 0; h < 24; h++) {
        const isN = nightHours.includes(h);
        usage.push({
          timestamp: buildTimestamp(h),
          kwhImport: isN ? perNight : perDay,
          kwhExport: 0,
        });
      }
    }
  }

  const plan: RatePlanRef = {
    id: "efl-validator",
    displayName: "EFL Validator Plan",
    source: "efl_validator",
    tdspCode: null,
  };

  try {
    const result = computePlanCost({
      plan: { plan, rules: planRules },
      usage,
      tz: VALIDATION_TZ,
    });
    const totalDollars = result.totalCostDollars;
    const avgCents = (totalDollars * 100) / kwh;
    if (!Number.isFinite(avgCents)) return null;
    return avgCents;
  } catch {
    return null;
  }
}

// -------------------- Public validator --------------------

export async function validateEflAvgPriceTable(args: {
  rawText: string;
  planRules: PlanRules | any;
  rateStructure: RateStructure | any;
  toleranceCentsPerKwh?: number;
}): Promise<EflAvgPriceValidation> {
  const { rawText } = args;
  const planRules = args.planRules as PlanRules;
  const rateStructure = args.rateStructure as RateStructure | null;
  const tolerance = args.toleranceCentsPerKwh ?? DEFAULT_TOLERANCE_CENTS_PER_KWH;

  const points = extractEflAvgPricePoints(rawText);

  const avgTableFound = Array.isArray(points) && points.length > 0;

  // Build a small snippet around the Average Monthly Use / Average price lines
  // so the admin UI can show exactly what was parsed.
  let avgTableSnippet: string | undefined;
  if (avgTableFound) {
    const lines = rawText.split(/\r?\n/);
    const startIdx = lines.findIndex((l) =>
      /Average\s+(Monthly\s+Use|monthly\s+use)/i.test(l),
    );
    if (startIdx >= 0) {
      const endIdx = Math.min(lines.length, startIdx + 6);
      const block = lines.slice(startIdx, endIdx).join("\n");
      avgTableSnippet = block.slice(0, 800);
    }
  }

  if (!points || points.length === 0) {
    return {
      status: "SKIP",
      toleranceCentsPerKwh: tolerance,
      points: [],
      assumptionsUsed: {},
      fail: false,
      notes: ["EFL Average Price table (500/1000/2000) not found in text."],
      avgTableFound: false,
    };
  }

  // We still detect assumption-based language (e.g., free nights examples)
  // but we do NOT skip validation outright anymore. Instead we pass any
  // parsed night-hours assumptions into the cost engine so the modeled
  // averages line up with the EFL's own methodology.
  const assumption = isAssumptionBasedAvgPriceTable(rawText);
  const nightAssumption = parseEflNightHoursAssumption(rawText) ?? undefined;

  const tdspIncludedFlag =
    (planRules as any).tdspDeliveryIncludedInEnergyCharge === true ||
    (rateStructure as any)?.tdspDeliveryIncludedInEnergyCharge === true
      ? true
      : undefined;

  const modeledPoints: EflAvgPriceValidation["points"] = [];

  for (const p of points) {
    const modeledAvg = await computeModeledAvgCentsPerKwhOrNull({
      planRules,
      rateStructure,
      kwh: p.kwh,
      nightUsagePercent: nightAssumption?.nightUsagePercent,
      nightStartHour: nightAssumption?.nightStartHour,
      nightEndHour: nightAssumption?.nightEndHour,
    });

    if (modeledAvg == null || Number.isNaN(modeledAvg)) {
      modeledPoints.push({
        usageKwh: p.kwh,
        expectedAvgCentsPerKwh: p.eflAvgCentsPerKwh,
        modeledAvgCentsPerKwh: null,
        diffCentsPerKwh: null,
        ok: false,
      });
      continue;
    }

    const diff = modeledAvg - p.eflAvgCentsPerKwh;
    const absDiff = Math.abs(diff);
    modeledPoints.push({
      usageKwh: p.kwh,
      expectedAvgCentsPerKwh: p.eflAvgCentsPerKwh,
      modeledAvgCentsPerKwh: Number(modeledAvg.toFixed(4)),
      diffCentsPerKwh: Number(diff.toFixed(4)),
      ok: absDiff <= tolerance,
    });
  }

  const anyModeled = modeledPoints.some((p) => p.modeledAvgCentsPerKwh != null);
  if (!anyModeled) {
    return {
      status: "SKIP",
      toleranceCentsPerKwh: tolerance,
      points: modeledPoints,
      assumptionsUsed: {
        nightUsagePercent: nightAssumption?.nightUsagePercent,
        nightStartHour: nightAssumption?.nightStartHour,
        nightEndHour: nightAssumption?.nightEndHour,
        tdspIncludedInEnergyCharge: tdspIncludedFlag,
      },
      fail: false,
      notes: [
        "Canonical plan-cost calculator could not be applied for any avg-price point; skipping validation.",
      ],
      avgTableFound,
      avgTableRows: points.map((p) => ({
        kwh: p.kwh,
        avgPriceCentsPerKwh: p.eflAvgCentsPerKwh,
      })),
      avgTableSnippet,
    };
  }

  const maxAbsDiff = modeledPoints.reduce((max, p) => {
    if (p.diffCentsPerKwh == null) return max;
    const v = Math.abs(p.diffCentsPerKwh);
    return v > max ? v : max;
  }, 0);

  const allOk =
    modeledPoints.length > 0 &&
    modeledPoints.every(
      (p) => p.modeledAvgCentsPerKwh != null && p.ok === true,
    );

  if (allOk) {
    return {
      status: "PASS",
      toleranceCentsPerKwh: tolerance,
      points: modeledPoints,
      assumptionsUsed: {
        nightUsagePercent: nightAssumption?.nightUsagePercent,
        nightStartHour: nightAssumption?.nightStartHour,
        nightEndHour: nightAssumption?.nightEndHour,
        tdspIncludedInEnergyCharge: tdspIncludedFlag,
      },
      fail: false,
      notes: [],
      avgTableFound,
      avgTableRows: points.map((p) => ({
        kwh: p.kwh,
        avgPriceCentsPerKwh: p.eflAvgCentsPerKwh,
      })),
      avgTableSnippet,
    };
  }

  return {
    status: "FAIL",
    toleranceCentsPerKwh: tolerance,
    points: modeledPoints,
    assumptionsUsed: {
      nightUsagePercent: nightAssumption?.nightUsagePercent,
      nightStartHour: nightAssumption?.nightStartHour,
      nightEndHour: nightAssumption?.nightEndHour,
      tdspIncludedInEnergyCharge: tdspIncludedFlag,
    },
    fail: true,
    queueReason:
      "EFL average price table mismatch (modeled vs expected) — manual admin review required.",
    notes: [
      `Modeled avg ¢/kWh differs from EFL avg price table by up to ${maxAbsDiff.toFixed(
        4,
      )} ¢/kWh (tolerance ${tolerance} ¢/kWh).`,
    ],
    avgTableFound,
    avgTableRows: points.map((p) => ({
      kwh: p.kwh,
      avgPriceCentsPerKwh: p.eflAvgCentsPerKwh,
    })),
    avgTableSnippet,
  };
}


