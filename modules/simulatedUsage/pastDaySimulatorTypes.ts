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
};

/** Request to simulate one past day. */
export type PastDaySimulationRequest = {
  localDate: string;
  isWeekend: boolean;
  /** 96 ISO timestamps for the day (slot 0..95). */
  gridTimestamps: string[];
  weatherForDay: PastDayWeatherFeatures | null;
};

/** Result of simulating one past day. */
export type PastDaySimulationResult = {
  intervals: Array<{ timestamp: string; kwh: number }>;
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
  /** Diagnostics: why aux heat did or did not apply. */
  auxHeatGate_minTempPassed?: boolean;
  auxHeatGate_freezeHoursPassed?: boolean;
  auxHeatGate_severityPassed?: boolean;
  /** Reference heating severity (ref HDD) used for aux gate and ratio. */
  referenceHeatingSeverity?: number;
  /** Pre-blend adjusted total (profile × weatherSeverityMultiplier, before aux/pool adders and blend). */
  preBlendAdjustedDayKwh?: number;
  /** True when day was weather_scaled_day and 80/20 blend-back toward profile was applied. */
  blendedBackTowardProfile?: boolean;
};

export type PastDayWeatherClassification =
  | "normal_day"
  | "weather_scaled_day"
  | "extreme_cold_event_day"
  | "freeze_protect_day";

export type PastDayFallbackLevel =
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
