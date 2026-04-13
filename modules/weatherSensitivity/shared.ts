import { buildManualBillPeriodTargets, buildManualBillPeriodTotalsById } from "@/modules/manualUsage/statementRanges";
import type { ManualUsagePayload } from "@/modules/simulatedUsage/types";
import { getHouseWeatherDays } from "@/modules/weather/repo";
import { enumerateDateKeysInclusive } from "@/lib/time/chicago";

const SCORE_VERSION = "weather-sensitivity-v1";
const CALCULATION_VERSION = "weather-sensitivity-v1";

type DailyWeatherLike = {
  tAvgF?: number | null;
  tMinF?: number | null;
  tMaxF?: number | null;
  hdd65?: number | null;
  cdd65?: number | null;
};

type DailyUsageLike = {
  date?: string | null;
  kwh?: number | null;
  source?: string | null;
  sourceDetail?: string | null;
};

export type WeatherSensitivityScore = {
  scoringMode: "INTERVAL_BASED" | "BILLING_PERIOD_BASED";
  weatherEfficiencyScore0to100: number;
  coolingSensitivityScore0to100: number;
  heatingSensitivityScore0to100: number;
  confidenceScore0to100: number;
  shoulderBaselineKwhPerDay: number;
  coolingSlopeKwhPerCDD: number;
  heatingSlopeKwhPerHDD: number;
  coolingResponseRatio: number;
  heatingResponseRatio: number;
  estimatedWeatherDrivenLoadShare: number;
  estimatedBaseloadShare: number;
  requiredInputAdjustmentsApplied: string[];
  poolAdjustmentApplied: boolean;
  hvacAdjustmentApplied: boolean;
  occupancyAdjustmentApplied: boolean;
  thermostatAdjustmentApplied: boolean;
  eligibleActualDayCount?: number;
  eligibleBillPeriodCount?: number;
  excludedSimulatedDayCount: number;
  excludedTravelDayCount?: number;
  excludedTravelBillPeriodCount?: number;
  excludedIncompleteMeterDayCount: number;
  scoreVersion: string;
  calculationVersion: string;
  recommendationFlags: {
    appearsWeatherSensitive: boolean;
    needsMoreApplianceDetail: boolean;
    needsEnvelopeDetail: boolean;
    confidenceLimited: boolean;
  };
  explanationSummary: string;
  nextDetailPromptType: "NONE" | "ADD_APPLIANCE_DETAILS" | "ADD_ENVELOPE_DETAILS";
};

export type WeatherEfficiencyDerivedInput = {
  derivedInputAttached: true;
  simulationActive: false;
  scoringMode: WeatherSensitivityScore["scoringMode"];
  weatherEfficiencyScore0to100: number;
  coolingSensitivityScore0to100: number;
  heatingSensitivityScore0to100: number;
  confidenceScore0to100: number;
  shoulderBaselineKwhPerDay: number;
  coolingSlopeKwhPerCDD: number;
  heatingSlopeKwhPerHDD: number;
  coolingResponseRatio: number;
  heatingResponseRatio: number;
  estimatedWeatherDrivenLoadShare: number;
  estimatedBaseloadShare: number;
  requiredInputAdjustmentsApplied: string[];
  poolAdjustmentApplied: boolean;
  hvacAdjustmentApplied: boolean;
  occupancyAdjustmentApplied: boolean;
  thermostatAdjustmentApplied: boolean;
  scoreVersion: string;
  calculationVersion: string;
};

export type WeatherSensitivityEnvelope = {
  score: WeatherSensitivityScore | null;
  derivedInput: WeatherEfficiencyDerivedInput | null;
};

type SharedScoreArgs = {
  actualDataset?: any;
  dailyWeather?: Record<string, DailyWeatherLike> | null;
  manualUsagePayload?: ManualUsagePayload | null;
  manualScoringContext?: Record<string, unknown> | null;
  compareProjection?: Record<string, unknown> | null;
  homeProfile?: any;
  applianceProfile?: any;
};

type ResolveSharedScoreArgs = SharedScoreArgs & {
  weatherHouseId?: string | null;
};

type FactorContext = {
  squareFeet: number | null;
  occupantCount: number;
  occupantsHomeAllDay: number;
  heatingFuel: string;
  hvacType: string;
  heatingType: string;
  thermostatSummerF: number | null;
  thermostatWinterF: number | null;
  hasPool: boolean;
  poolPumpHp: number | null;
  hasEv: boolean;
  hvacAgeYears: number | null;
  hvacSeer: number | null;
  insulationKnown: boolean;
  windowsKnown: boolean;
  applianceDetailRich: boolean;
};

type FitPoint = {
  kwhPerDay: number;
  tAvgF: number;
  hdd65: number;
  cdd65: number;
};

type FitSummary = {
  baseline: number;
  coolingSlope: number;
  heatingSlope: number;
  coolingShare: number;
  heatingShare: number;
  coolingPoints: number;
  heatingPoints: number;
  shoulderPoints: number;
};

function round2(value: number): number {
  return Math.round((Number(value) || 0) * 100) / 100;
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

function asNumber(value: unknown): number | null {
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function normalizeDateKey(value: unknown): string {
  return typeof value === "string" ? value.slice(0, 10) : "";
}

function toWeatherRecord(input: unknown): Record<string, DailyWeatherLike> {
  if (!input || typeof input !== "object" || Array.isArray(input)) return {};
  return input as Record<string, DailyWeatherLike>;
}

function sourceLooksSimulated(source: unknown, detail: unknown): boolean {
  const combined = `${String(source ?? "").toUpperCase()} ${String(detail ?? "").toUpperCase()}`;
  return combined.includes("SIMULATED");
}

function sourceLooksTravel(detail: unknown): boolean {
  return String(detail ?? "").toUpperCase().includes("TRAVEL");
}

function sourceLooksIncomplete(detail: unknown): boolean {
  return String(detail ?? "").toUpperCase().includes("INCOMPLETE");
}

function enumerateDateKeysInRecord(record: Record<string, DailyWeatherLike>, startDate: string, endDate: string): string[] {
  return Object.keys(record)
    .filter((dateKey) => dateKey >= startDate && dateKey <= endDate)
    .sort();
}

function buildFactorContext(homeProfile: any, applianceProfile: any): FactorContext {
  const poolFromHome = Boolean(homeProfile?.hasPool ?? homeProfile?.pool?.hasPool);
  const appliances = Array.isArray(applianceProfile?.appliances) ? applianceProfile.appliances : [];
  const applianceTypes: string[] = appliances.map((item: any) => String(item?.type ?? item?.kind ?? "").toUpperCase());
  const poolFromAppliances = applianceTypes.some((type: string) => type.includes("POOL"));
  const evFromAppliances = applianceTypes.some((type: string) => type.includes("EV"));
  const occupants =
    asNumber(homeProfile?.occupants?.total) ??
    ((asNumber(homeProfile?.occupantsWork) ?? 0) +
      (asNumber(homeProfile?.occupantsSchool) ?? 0) +
      (asNumber(homeProfile?.occupantsHomeAllDay) ?? 0));
  const occupantsHomeAllDay =
    asNumber(homeProfile?.occupants?.homeAllDay) ?? asNumber(homeProfile?.occupantsHomeAllDay) ?? 0;
  const thermostatSummerF =
    asNumber(homeProfile?.thermostatSummerF) ?? asNumber(homeProfile?.summerTemp) ?? asNumber(homeProfile?.summerSetpointF);
  const thermostatWinterF =
    asNumber(homeProfile?.thermostatWinterF) ?? asNumber(homeProfile?.winterTemp) ?? asNumber(homeProfile?.winterSetpointF);
  const hvacAgeYears = asNumber(homeProfile?.hvacAgeYears) ?? asNumber(homeProfile?.hvacAge);
  const hvacSeer = asNumber(homeProfile?.hvacSeer) ?? asNumber(homeProfile?.seer);
  const heatingFuel =
    String(
      applianceProfile?.fuelConfiguration?.heating ??
        homeProfile?.fuelConfiguration?.heating ??
        homeProfile?.fuelConfiguration ??
        ""
    )
      .trim()
      .toLowerCase() || "unknown";
  return {
    squareFeet: asNumber(homeProfile?.squareFeet),
    occupantCount: clamp(occupants, 0, 12),
    occupantsHomeAllDay: clamp(occupantsHomeAllDay, 0, 12),
    heatingFuel,
    hvacType: String(homeProfile?.hvacType ?? "").trim().toLowerCase(),
    heatingType: String(homeProfile?.heatingType ?? "").trim().toLowerCase(),
    thermostatSummerF,
    thermostatWinterF,
    hasPool: poolFromHome || poolFromAppliances,
    poolPumpHp: asNumber(homeProfile?.poolPumpHp ?? homeProfile?.pool?.pumpHp),
    hasEv: Boolean(homeProfile?.evHasVehicle ?? homeProfile?.ev?.hasVehicle ?? evFromAppliances),
    hvacAgeYears,
    hvacSeer,
    insulationKnown: Boolean(homeProfile?.insulationType ?? homeProfile?.insulation),
    windowsKnown: Boolean(homeProfile?.windowType ?? homeProfile?.windows),
    applianceDetailRich:
      appliances.length >= 2 ||
      Boolean(homeProfile?.hasPool ?? homeProfile?.pool?.hasPool) ||
      Boolean(homeProfile?.evHasVehicle ?? homeProfile?.ev?.hasVehicle),
  };
}

function buildAdjustmentContext(factors: FactorContext) {
  const requiredInputAdjustmentsApplied: string[] = [];
  let expectedCoolingFactor = 1;
  let expectedHeatingFactor = 1;
  let poolAdjustmentApplied = false;
  let hvacAdjustmentApplied = false;
  let occupancyAdjustmentApplied = false;
  let thermostatAdjustmentApplied = false;

  if (factors.squareFeet != null) {
    const sizeFactor = clamp(factors.squareFeet / 2000, 0.7, 1.7);
    expectedCoolingFactor *= sizeFactor;
    expectedHeatingFactor *= sizeFactor;
    requiredInputAdjustmentsApplied.push("square_footage");
  }
  if (factors.occupantCount > 0 || factors.occupantsHomeAllDay > 0) {
    const occupancyFactor = 1 + Math.min(factors.occupantCount, 6) * 0.04 + Math.min(factors.occupantsHomeAllDay, 3) * 0.06;
    expectedCoolingFactor *= occupancyFactor;
    expectedHeatingFactor *= 1 + Math.min(factors.occupantsHomeAllDay, 3) * 0.03;
    occupancyAdjustmentApplied = true;
    requiredInputAdjustmentsApplied.push("occupancy");
  }
  if (factors.heatingFuel) {
    if (factors.heatingFuel.includes("gas")) expectedHeatingFactor *= 0.72;
    else if (factors.heatingFuel.includes("electric")) expectedHeatingFactor *= 1.14;
    else if (factors.heatingType.includes("heat_pump")) expectedHeatingFactor *= 0.95;
    requiredInputAdjustmentsApplied.push("fuel_configuration");
  }
  if (factors.hasPool) {
    expectedCoolingFactor *= 1.12 + Math.max(0, (factors.poolPumpHp ?? 0) - 1) * 0.04;
    poolAdjustmentApplied = true;
    requiredInputAdjustmentsApplied.push("pool");
  }
  if (factors.hasEv) {
    expectedCoolingFactor *= 1.03;
    expectedHeatingFactor *= 1.03;
    requiredInputAdjustmentsApplied.push("ev");
  }
  if (factors.hvacType || factors.heatingType || factors.hvacAgeYears != null || factors.hvacSeer != null) {
    const agePenalty = factors.hvacAgeYears != null && factors.hvacAgeYears > 15 ? 1.08 : 1;
    const seerFactor =
      factors.hvacSeer == null ? 1 : factors.hvacSeer < 14 ? 1.1 : factors.hvacSeer >= 18 ? 0.93 : 1;
    expectedCoolingFactor *= agePenalty * seerFactor;
    expectedHeatingFactor *= factors.heatingType.includes("resistance") ? 1.1 : 1;
    hvacAdjustmentApplied = true;
    requiredInputAdjustmentsApplied.push("hvac");
  }
  if (factors.thermostatSummerF != null || factors.thermostatWinterF != null) {
    if (factors.thermostatSummerF != null) {
      expectedCoolingFactor *= 1 + Math.max(0, 74 - factors.thermostatSummerF) * 0.05;
    }
    if (factors.thermostatWinterF != null) {
      expectedHeatingFactor *= 1 + Math.max(0, factors.thermostatWinterF - 68) * 0.04;
    }
    thermostatAdjustmentApplied = true;
    requiredInputAdjustmentsApplied.push("thermostat");
  }

  return {
    expectedCoolingFactor,
    expectedHeatingFactor,
    requiredInputAdjustmentsApplied,
    poolAdjustmentApplied,
    hvacAdjustmentApplied,
    occupancyAdjustmentApplied,
    thermostatAdjustmentApplied,
  };
}

function computeBaseline(points: FitPoint[]): { baseline: number; shoulderPoints: number } {
  const shoulder = points.filter((point) => point.hdd65 <= 3 && point.cdd65 <= 3);
  const basis =
    shoulder.length > 0
      ? shoulder
      : [...points]
          .sort((a, b) => a.hdd65 + a.cdd65 - (b.hdd65 + b.cdd65))
          .slice(0, Math.max(1, Math.ceil(points.length * 0.25)));
  const baseline = basis.reduce((sum, point) => sum + point.kwhPerDay, 0) / Math.max(1, basis.length);
  return { baseline: round2(baseline), shoulderPoints: basis.length };
}

function computeSlope(points: FitPoint[], degreeKey: "hdd65" | "cdd65", baseline: number) {
  let numerator = 0;
  let denominator = 0;
  let positiveExcessSum = 0;
  let totalUsageSum = 0;
  let count = 0;
  for (const point of points) {
    const degree = point[degreeKey];
    if (!(degree > 0)) continue;
    const delta = point.kwhPerDay - baseline;
    numerator += delta * degree;
    denominator += degree * degree;
    positiveExcessSum += Math.max(0, delta);
    totalUsageSum += point.kwhPerDay;
    count += 1;
  }
  const slope = denominator > 0 ? Math.max(0, numerator / denominator) : 0;
  const weatherShare = totalUsageSum > 0 ? clamp(positiveExcessSum / totalUsageSum, 0, 1) : 0;
  return {
    slope: round2(slope),
    weatherShare,
    count,
  };
}

function computeFit(points: FitPoint[]): FitSummary {
  const { baseline, shoulderPoints } = computeBaseline(points);
  const cooling = computeSlope(points.filter((point) => point.cdd65 > 0), "cdd65", baseline);
  const heating = computeSlope(points.filter((point) => point.hdd65 > 0), "hdd65", baseline);
  return {
    baseline,
    coolingSlope: cooling.slope,
    heatingSlope: heating.slope,
    coolingShare: cooling.weatherShare,
    heatingShare: heating.weatherShare,
    coolingPoints: cooling.count,
    heatingPoints: heating.count,
    shoulderPoints,
  };
}

function buildExplanation(args: {
  scoringMode: WeatherSensitivityScore["scoringMode"];
  weatherEfficiencyScore0to100: number;
  coolingSensitivityScore0to100: number;
  heatingSensitivityScore0to100: number;
  factors: FactorContext;
}): string {
  const dominant =
    args.coolingSensitivityScore0to100 >= args.heatingSensitivityScore0to100 ? "hot" : "cold";
  const factorNotes: string[] = [];
  if (args.factors.hasPool) factorNotes.push("pool");
  if (args.factors.hvacType || args.factors.heatingType) factorNotes.push("HVAC");
  if (args.factors.thermostatSummerF != null || args.factors.thermostatWinterF != null) factorNotes.push("thermostat");
  const factorText = factorNotes.length > 0 ? ` after accounting for ${factorNotes.join(", ")}` : "";
  if (args.weatherEfficiencyScore0to100 <= 45) {
    return `This home appears weather sensitive. Usage climbs quickly on ${dominant} days${factorText}.`;
  }
  if (args.weatherEfficiencyScore0to100 >= 75) {
    return `This home looks relatively stable versus weather. The score reflects measured usage movement${factorText}.`;
  }
  return `This home's usage has a moderate weather response. The score reflects measured hot and cold day movement${factorText}.`;
}

function finalizeScore(args: {
  scoringMode: WeatherSensitivityScore["scoringMode"];
  fit: FitSummary;
  factors: FactorContext;
  eligibleActualDayCount?: number;
  eligibleBillPeriodCount?: number;
  excludedSimulatedDayCount: number;
  excludedTravelDayCount?: number;
  excludedTravelBillPeriodCount?: number;
  excludedIncompleteMeterDayCount: number;
}): WeatherSensitivityScore {
  const adjustments = buildAdjustmentContext(args.factors);
  const expectedCoolingSlope = round2(0.75 * adjustments.expectedCoolingFactor);
  const expectedHeatingSlope = round2(0.6 * adjustments.expectedHeatingFactor);
  const coolingResponseRatio = expectedCoolingSlope > 0 ? round2(args.fit.coolingSlope / expectedCoolingSlope) : 0;
  const heatingResponseRatio = expectedHeatingSlope > 0 ? round2(args.fit.heatingSlope / expectedHeatingSlope) : 0;
  const coolingSensitivityScore0to100 = clamp(
    Math.round(coolingResponseRatio * 42 + args.fit.coolingShare * 35),
    0,
    100
  );
  const heatingSensitivityScore0to100 = clamp(
    Math.round(heatingResponseRatio * 42 + args.fit.heatingShare * 35),
    0,
    100
  );
  const estimatedWeatherDrivenLoadShare = round2(clamp(Math.max(args.fit.coolingShare, args.fit.heatingShare), 0, 1));
  const estimatedBaseloadShare = round2(clamp(1 - estimatedWeatherDrivenLoadShare, 0, 1));
  const eligibleCount = Math.max(args.eligibleActualDayCount ?? 0, args.eligibleBillPeriodCount ?? 0);
  const coverageScore = clamp(eligibleCount * 6, 0, 55);
  const seasonScore = (args.fit.coolingPoints > 0 ? 15 : 0) + (args.fit.heatingPoints > 0 ? 15 : 0) + (args.fit.shoulderPoints > 0 ? 10 : 0);
  const factorCompletenessScore =
    (args.factors.squareFeet != null ? 5 : 0) +
    (args.factors.hvacType || args.factors.heatingType ? 5 : 0) +
    (args.factors.thermostatSummerF != null || args.factors.thermostatWinterF != null ? 5 : 0) +
    (args.factors.heatingFuel !== "unknown" ? 5 : 0);
  const confidenceScore0to100 = clamp(Math.round(coverageScore + seasonScore + factorCompletenessScore), 0, 100);
  const inefficiencyPenalty =
    Math.max(coolingResponseRatio - 1, 0) * 20 +
    Math.max(heatingResponseRatio - 1, 0) * 20 +
    estimatedWeatherDrivenLoadShare * 22 +
    Math.max(0, 60 - confidenceScore0to100) * 0.2;
  const weatherEfficiencyScore0to100 = clamp(Math.round(88 - inefficiencyPenalty), 0, 100);
  const appearsWeatherSensitive =
    weatherEfficiencyScore0to100 <= 45 || coolingSensitivityScore0to100 >= 70 || heatingSensitivityScore0to100 >= 70;
  const confidenceLimited = confidenceScore0to100 < 55;
  const needsMoreApplianceDetail = appearsWeatherSensitive && confidenceLimited && !args.factors.applianceDetailRich;
  const needsEnvelopeDetail = appearsWeatherSensitive && (!args.factors.insulationKnown || !args.factors.windowsKnown);
  const nextDetailPromptType =
    needsMoreApplianceDetail ? "ADD_APPLIANCE_DETAILS" : needsEnvelopeDetail ? "ADD_ENVELOPE_DETAILS" : "NONE";

  return {
    scoringMode: args.scoringMode,
    weatherEfficiencyScore0to100,
    coolingSensitivityScore0to100,
    heatingSensitivityScore0to100,
    confidenceScore0to100,
    shoulderBaselineKwhPerDay: args.fit.baseline,
    coolingSlopeKwhPerCDD: args.fit.coolingSlope,
    heatingSlopeKwhPerHDD: args.fit.heatingSlope,
    coolingResponseRatio,
    heatingResponseRatio,
    estimatedWeatherDrivenLoadShare,
    estimatedBaseloadShare,
    requiredInputAdjustmentsApplied: adjustments.requiredInputAdjustmentsApplied,
    poolAdjustmentApplied: adjustments.poolAdjustmentApplied,
    hvacAdjustmentApplied: adjustments.hvacAdjustmentApplied,
    occupancyAdjustmentApplied: adjustments.occupancyAdjustmentApplied,
    thermostatAdjustmentApplied: adjustments.thermostatAdjustmentApplied,
    ...(args.eligibleActualDayCount != null ? { eligibleActualDayCount: args.eligibleActualDayCount } : {}),
    ...(args.eligibleBillPeriodCount != null ? { eligibleBillPeriodCount: args.eligibleBillPeriodCount } : {}),
    excludedSimulatedDayCount: args.excludedSimulatedDayCount,
    ...(args.excludedTravelDayCount != null ? { excludedTravelDayCount: args.excludedTravelDayCount } : {}),
    ...(args.excludedTravelBillPeriodCount != null
      ? { excludedTravelBillPeriodCount: args.excludedTravelBillPeriodCount }
      : {}),
    excludedIncompleteMeterDayCount: args.excludedIncompleteMeterDayCount,
    scoreVersion: SCORE_VERSION,
    calculationVersion: CALCULATION_VERSION,
    recommendationFlags: {
      appearsWeatherSensitive,
      needsMoreApplianceDetail,
      needsEnvelopeDetail,
      confidenceLimited,
    },
    explanationSummary: buildExplanation({
      scoringMode: args.scoringMode,
      weatherEfficiencyScore0to100,
      coolingSensitivityScore0to100,
      heatingSensitivityScore0to100,
      factors: args.factors,
    }),
    nextDetailPromptType,
  };
}

function buildIntervalBasedScore(args: SharedScoreArgs, factors: FactorContext): WeatherSensitivityScore | null {
  const dataset = args.actualDataset;
  const dailyRows = Array.isArray(dataset?.daily) ? (dataset.daily as DailyUsageLike[]) : [];
  const weatherRecord = toWeatherRecord(args.dailyWeather ?? dataset?.dailyWeather);
  if (dailyRows.length === 0 || Object.keys(weatherRecord).length === 0) return null;

  let excludedSimulatedDayCount = 0;
  let excludedTravelDayCount = 0;
  let excludedIncompleteMeterDayCount = 0;
  const points: FitPoint[] = [];
  for (const row of dailyRows) {
    const dateKey = normalizeDateKey(row?.date);
    if (!dateKey) continue;
    const weather = weatherRecord[dateKey];
    if (!weather) continue;
    if (sourceLooksSimulated(row?.source, row?.sourceDetail)) {
      excludedSimulatedDayCount += 1;
      if (sourceLooksTravel(row?.sourceDetail)) excludedTravelDayCount += 1;
      if (sourceLooksIncomplete(row?.sourceDetail)) excludedIncompleteMeterDayCount += 1;
      continue;
    }
    const kwh = asNumber(row?.kwh);
    const tAvgF = asNumber(weather.tAvgF);
    const hdd65 = asNumber(weather.hdd65);
    const cdd65 = asNumber(weather.cdd65);
    if (kwh == null || tAvgF == null || hdd65 == null || cdd65 == null) continue;
    points.push({ kwhPerDay: kwh, tAvgF, hdd65, cdd65 });
  }
  if (points.length < 3) return null;
  const fit = computeFit(points);
  return finalizeScore({
    scoringMode: "INTERVAL_BASED",
    fit,
    factors,
    eligibleActualDayCount: points.length,
    excludedSimulatedDayCount,
    excludedTravelDayCount,
    excludedIncompleteMeterDayCount,
  });
}

function buildBillingPeriodBasedScore(args: SharedScoreArgs, factors: FactorContext): WeatherSensitivityScore | null {
  const payload = args.manualUsagePayload;
  if (!payload) return null;
  const weatherRecord = toWeatherRecord(args.dailyWeather ?? args.actualDataset?.dailyWeather);
  const billPeriods = buildManualBillPeriodTargets(payload);
  if (billPeriods.length === 0 || Object.keys(weatherRecord).length === 0) return null;
  const totalsById = buildManualBillPeriodTotalsById(billPeriods);
  let excludedTravelBillPeriodCount = 0;
  const points: FitPoint[] = [];
  for (const period of billPeriods) {
    if (!period.eligibleForConstraint) {
      if (period.exclusionReason === "travel_overlap") excludedTravelBillPeriodCount += 1;
      continue;
    }
    const dateKeys = enumerateDateKeysInRecord(weatherRecord, period.startDate, period.endDate);
    if (dateKeys.length === 0) continue;
    let tAvgFSum = 0;
    let hdd65Sum = 0;
    let cdd65Sum = 0;
    for (const dateKey of dateKeys) {
      const weather = weatherRecord[dateKey];
      tAvgFSum += Number(weather?.tAvgF) || 0;
      hdd65Sum += Number(weather?.hdd65) || 0;
      cdd65Sum += Number(weather?.cdd65) || 0;
    }
    const enteredTotal = asNumber(totalsById[period.id] ?? period.enteredKwh);
    if (enteredTotal == null) continue;
    const dayCount = dateKeys.length;
    points.push({
      kwhPerDay: enteredTotal / Math.max(1, dayCount),
      tAvgF: tAvgFSum / Math.max(1, dayCount),
      hdd65: hdd65Sum / Math.max(1, dayCount),
      cdd65: cdd65Sum / Math.max(1, dayCount),
    });
  }
  if (points.length === 0) return null;
  const fit = computeFit(points);
  return finalizeScore({
    scoringMode: "BILLING_PERIOD_BASED",
    fit,
    factors,
    eligibleBillPeriodCount: points.length,
    excludedTravelBillPeriodCount,
    excludedSimulatedDayCount: 0,
    excludedIncompleteMeterDayCount: 0,
  });
}

export function buildSharedWeatherSensitivityScore(args: SharedScoreArgs): WeatherSensitivityScore | null {
  const factors = buildFactorContext(args.homeProfile, args.applianceProfile);
  const billingScore =
    args.manualUsagePayload != null ? buildBillingPeriodBasedScore(args, factors) : null;
  if (billingScore) return billingScore;
  return buildIntervalBasedScore(args, factors);
}

export function buildWeatherEfficiencyDerivedInput(
  score: WeatherSensitivityScore | null | undefined
): WeatherEfficiencyDerivedInput | null {
  if (!score) return null;
  return {
    derivedInputAttached: true,
    simulationActive: false,
    scoringMode: score.scoringMode,
    weatherEfficiencyScore0to100: score.weatherEfficiencyScore0to100,
    coolingSensitivityScore0to100: score.coolingSensitivityScore0to100,
    heatingSensitivityScore0to100: score.heatingSensitivityScore0to100,
    confidenceScore0to100: score.confidenceScore0to100,
    shoulderBaselineKwhPerDay: score.shoulderBaselineKwhPerDay,
    coolingSlopeKwhPerCDD: score.coolingSlopeKwhPerCDD,
    heatingSlopeKwhPerHDD: score.heatingSlopeKwhPerHDD,
    coolingResponseRatio: score.coolingResponseRatio,
    heatingResponseRatio: score.heatingResponseRatio,
    estimatedWeatherDrivenLoadShare: score.estimatedWeatherDrivenLoadShare,
    estimatedBaseloadShare: score.estimatedBaseloadShare,
    requiredInputAdjustmentsApplied: [...score.requiredInputAdjustmentsApplied],
    poolAdjustmentApplied: score.poolAdjustmentApplied,
    hvacAdjustmentApplied: score.hvacAdjustmentApplied,
    occupancyAdjustmentApplied: score.occupancyAdjustmentApplied,
    thermostatAdjustmentApplied: score.thermostatAdjustmentApplied,
    scoreVersion: score.scoreVersion,
    calculationVersion: score.calculationVersion,
  };
}

async function maybeLoadWeatherRecord(args: ResolveSharedScoreArgs): Promise<Record<string, DailyWeatherLike>> {
  const existing = toWeatherRecord(args.dailyWeather ?? args.actualDataset?.dailyWeather);
  if (Object.keys(existing).length > 0) return existing;
  if (!args.weatherHouseId) return existing;

  const dateKeys =
    args.manualUsagePayload != null
      ? buildManualBillPeriodTargets(args.manualUsagePayload)
          .flatMap((period) => enumerateDateKeysInclusive(period.startDate, period.endDate))
          .filter(Boolean)
      : Array.isArray(args.actualDataset?.daily)
        ? args.actualDataset.daily.map((row: any) => normalizeDateKey(row?.date)).filter(Boolean)
        : [];
  if (dateKeys.length === 0) return existing;
  const weatherDays = await getHouseWeatherDays({
    houseId: args.weatherHouseId,
    dateKeys,
    kind: "ACTUAL_LAST_YEAR",
  });
  const record: Record<string, DailyWeatherLike> = {};
  for (const [dateKey, weather] of Array.from(weatherDays.entries())) {
    record[dateKey] = weather;
  }
  return record;
}

export async function resolveSharedWeatherSensitivityEnvelope(
  args: ResolveSharedScoreArgs
): Promise<WeatherSensitivityEnvelope> {
  const dailyWeather = await maybeLoadWeatherRecord(args);
  const score = buildSharedWeatherSensitivityScore({
    ...args,
    dailyWeather,
  });
  return {
    score,
    derivedInput: buildWeatherEfficiencyDerivedInput(score),
  };
}
