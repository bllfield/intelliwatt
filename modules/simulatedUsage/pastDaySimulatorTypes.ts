/**
 * Types for the shared Past day simulator.
 * Used by both GapFill Lab and user-facing Past baseline.
 */

/** Daily weather features for one day (shared shape). */
export type PastDayWeatherFeatures = {
  dailyAvgTempC: number | null;
  dailyMinTempC: number | null;
  dailyMaxTempC: number | null;
  heatingDegreeSeverity: number;
  coolingDegreeSeverity: number;
  freezeHoursCount: number;
  solarRadiationDailyTotal?: number;
  cloudcoverAvg?: number | null;
  extremeCold?: boolean;
  freezeDay?: boolean;
};

/** Minimal profile for day-total selection: per-month per-daytype averages and counts. */
export type PastDayProfileLite = {
  monthKeys: string[];
  avgKwhPerDayWeekdayByMonth: number[];
  avgKwhPerDayWeekendByMonth: number[];
  weekdayCountByMonth: Record<string, number>;
  weekendCountByMonth: Record<string, number>;
  monthOverallAvgByMonth: Record<string, number>;
  monthOverallCountByMonth: Record<string, number>;
};

export type PastDayTypeKey = "weekday" | "weekend";
export type PastWeatherRegimeKey = "heating" | "cooling" | "neutral";

export type PastShapeBucket = {
  weekday?: number[] | null;
  weekend?: number[] | null;
};

export type PastShapeWeatherBucket = {
  heating?: number[] | null;
  cooling?: number[] | null;
  neutral?: number[] | null;
};

export type PastShapeWeatherDayTypeBucket = {
  weekday?: PastShapeWeatherBucket | null;
  weekend?: PastShapeWeatherBucket | null;
};

export type PastShapeVariants = {
  byMonth96?: Record<string, number[]> | null;
  byMonthDayType96?: Record<string, PastShapeBucket> | null;
  byMonthWeatherDayType96?: Record<string, PastShapeWeatherDayTypeBucket> | null;
  weekdayWeekend96?: PastShapeBucket | null;
  weekdayWeekendWeather96?: PastShapeWeatherDayTypeBucket | null;
};

export type PastNeighborDaySample = {
  localDate: string;
  dayOfMonth: number;
  dayKwh: number;
};

export type PastNeighborDayTotals = {
  weekdayByMonth?: Record<string, PastNeighborDaySample[]> | null;
  weekendByMonth?: Record<string, PastNeighborDaySample[]> | null;
};

/** Training weather aggregates by bucket (month+daytype, season+daytype, global). */
export type PastDayTrainingWeatherStats = {
  byMonthDaytype: Map<string, { avgDayKwh: number; avgHdd: number; avgCdd: number; count: number }>;
  bySeasonDaytype: Map<string, { avgDayKwh: number; avgHdd: number; avgCdd: number; count: number }>;
  global: {
    avgDayKwhWd: number;
    avgDayKwhWe: number;
    avgHddWd: number;
    avgHddWe: number;
    avgCddWd: number;
    avgCddWe: number;
    countWd: number;
    countWe: number;
  };
};

/** Reusable context for simulating past days (profile + weather stats + weather by date). */
export type PastDaySimulationContext = {
  profile: PastDayProfileLite;
  trainingWeatherStats: PastDayTrainingWeatherStats | null;
  weatherByDateKey: Map<string, PastDayWeatherFeatures>;
  neighborDayTotals?: PastNeighborDayTotals | null;
  shapeVariants?: PastShapeVariants | null;
};

/** Request to simulate one past day. */
export type PastDaySimulationRequest = {
  localDate: string;
  isWeekend: boolean;
  /** 96 ISO timestamps for the day (slot 0..95). */
  gridTimestamps: string[];
  weatherForDay: PastDayWeatherFeatures | null;
};

/** Canonical artifact for one simulated day. */
export type SimulatedDayResult = {
  localDate: string;
  source: "simulated_vacant_day";
  /**
   * Shared post-sim reason tag used by downstream consumers to separate
   * travel/vacant simulation from test-day modeled output.
   */
  simulatedReasonCode?:
    | "TRAVEL_VACANT"
    | "TEST_MODELED_KEEP_REF"
    | "FORCED_SELECTED_DAY"
    | "INCOMPLETE_METER_DAY"
    | "LEADING_MISSING_DAY";
  intervals: Array<{ timestamp: string; kwh: number }>;
  intervals15: number[];
  intervalSumKwh: number;
  displayDayKwh: number;
  rawDayKwh: number;
  weatherAdjustedDayKwh: number;
  profileSelectedDayKwh: number;
  finalDayKwh: number;
  weatherSeverityMultiplier: number;
  weatherModeUsed: "heating" | "cooling" | "neutral";
  auxHeatKwhAdder: number;
  poolFreezeProtectKwhAdder: number;
  dayClassification: PastDayWeatherClassification;
  fallbackLevel: PastDayFallbackLevel;
  clampApplied: boolean;
  shape96Used: number[];
  dayTypeUsed?: PastDayTypeKey;
  shapeVariantUsed?: string;
  weatherRegimeUsed?: PastWeatherRegimeKey;
  targetDayKwhBeforeWeather?: number;
  /** Diagnostics: why aux heat did or did not apply. */
  auxHeatGate_minTempPassed?: boolean;
  auxHeatGate_freezeHoursPassed?: boolean;
  auxHeatGate_severityPassed?: boolean;
  /** Reference heating severity (ref HDD) used for aux gate and ratio. */
  referenceHeatingSeverity?: number;
  /** Pre-blend adjusted total (profile × weatherSeverityMultiplier, before aux/pool adders and blend). */
  preBlendAdjustedDayKwh?: number;
  /** True when day was weather_scaled_day and a small profile anchor was blended with temperature-primary total. */
  blendedBackTowardProfile?: boolean;
};

/** Backward-compatible alias used by existing callers during migration. */
export type PastDaySimulationResult = SimulatedDayResult;

export type PastDayWeatherClassification =
  | "normal_day"
  | "weather_scaled_day"
  | "extreme_cold_event_day"
  | "freeze_protect_day";

export type PastDayFallbackLevel =
  | "month_daytype_neighbor"
  | "month_daytype"
  | "adjacent_month_daytype"
  | "month_overall"
  | "season_overall"
  | "global_daytype"
  | "global_overall";

/** Minimal home profile for weather adjustment (all-electric / electric heat / pool). */
export type PastDayHomeProfile = {
  fuelConfiguration?: string | null;
  heatingType?: string | null;
  hvacType?: string | null;
  pool?: { hasPool?: boolean; pumpType?: string | null; pumpHp?: number | null } | null;
};

export type PastDayApplianceProfile = {
  appliances?: Array<{ type?: string; data?: Record<string, unknown> }> | null;
};

/** Lightweight metadata to prove both paths use the same core. */
export const PAST_DAY_SIMULATOR_VERSION = "1.0.0";
export const SOURCE_OF_DAY_SIMULATION_CORE = "shared_past_day_simulator";
