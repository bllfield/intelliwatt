export type HomeProfileInput = {
  homeAge: number;
  homeStyle: string;
  squareFeet: number;
  stories: number;
  insulationType: string;
  windowType: string;
  foundation: string;
  ledLights: boolean;
  smartThermostat: boolean;
  summerTemp: number;
  winterTemp: number;
  occupantsWork: number;
  occupantsSchool: number;
  occupantsHomeAllDay: number;
  fuelConfiguration: string;
  hvacType?: string | null;
  heatingType?: string | null;
  hasPool?: boolean;
  poolPumpType?: string | null;
  poolPumpHp?: number | null;
  poolSummerRunHoursPerDay?: number | null;
  poolWinterRunHoursPerDay?: number | null;
  hasPoolHeater?: boolean;
  poolHeaterType?: string | null;
};

function clampInt(n: unknown, lo: number, hi: number): number {
  const x = typeof n === "number" && Number.isFinite(n) ? Math.trunc(n) : Number(n);
  const y = Number.isFinite(x) ? x : lo;
  return Math.max(lo, Math.min(hi, y));
}

function requireNonEmptyString(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const s = v.trim();
  return s.length ? s : null;
}

const HVAC_TYPES = new Set(["central", "heat_pump", "mini_split", "window", "portable", "other"]);
const HEATING_TYPES = new Set(["electric", "gas", "heat_pump", "other"]);
const POOL_PUMP_TYPES = new Set(["single_speed", "dual_speed", "variable_speed"]);
const POOL_HEATER_TYPES = new Set(["gas", "electric", "heat_pump", "solar"]);

function clampFloat(n: unknown, lo: number, hi: number): number {
  const x = typeof n === "number" && Number.isFinite(n) ? n : Number(n);
  const y = Number.isFinite(x) ? x : lo;
  return Math.max(lo, Math.min(hi, y));
}

export function validateHomeProfile(
  input: any,
  opts?: { requirePastBaselineFields?: boolean }
): { ok: true; value: HomeProfileInput } | { ok: false; error: string } {
  const homeAge = clampInt(input?.homeAge, 0, 200);
  const squareFeet = clampInt(input?.squareFeet, 100, 50_000);
  const stories = clampInt(input?.stories, 1, 10);
  const summerTemp = clampInt(input?.summerTemp ?? 73, 60, 90);
  const winterTemp = clampInt(input?.winterTemp ?? 70, 50, 80);
  const occupantsWork = clampInt(input?.occupantsWork, 0, 50);
  const occupantsSchool = clampInt(input?.occupantsSchool, 0, 50);
  const occupantsHomeAllDay = clampInt(input?.occupantsHomeAllDay, 0, 50);
  const occupantsTotal = occupantsWork + occupantsSchool + occupantsHomeAllDay;
  if (occupantsTotal <= 0) return { ok: false, error: "occupants_invalid" };

  const homeStyle = requireNonEmptyString(input?.homeStyle);
  const insulationType = requireNonEmptyString(input?.insulationType);
  const windowType = requireNonEmptyString(input?.windowType);
  const foundation = requireNonEmptyString(input?.foundation);
  const fuelConfiguration = requireNonEmptyString(input?.fuelConfiguration);
  if (!homeStyle) return { ok: false, error: "homeStyle_required" };
  if (!insulationType) return { ok: false, error: "insulationType_required" };
  if (!windowType) return { ok: false, error: "windowType_required" };
  if (!foundation) return { ok: false, error: "foundation_required" };
  if (!fuelConfiguration) return { ok: false, error: "fuelConfiguration_required" };

  const hvacTypeRaw = requireNonEmptyString(input?.hvacType);
  const heatingTypeRaw = requireNonEmptyString(input?.heatingType);
  const hvacType = hvacTypeRaw ?? null;
  const heatingType = heatingTypeRaw ?? null;
  if (hvacType && !HVAC_TYPES.has(hvacType)) return { ok: false, error: "hvacType_invalid" };
  if (heatingType && !HEATING_TYPES.has(heatingType)) return { ok: false, error: "heatingType_invalid" };

  const hasPool = Boolean(input?.hasPool);
  const hasPoolHeater = Boolean(input?.hasPoolHeater);
  const poolPumpTypeRaw = requireNonEmptyString(input?.poolPumpType);
  const poolPumpType = poolPumpTypeRaw ?? null;
  if (poolPumpType && !POOL_PUMP_TYPES.has(poolPumpType)) return { ok: false, error: "poolPumpType_invalid" };
  const poolHeaterTypeRaw = requireNonEmptyString(input?.poolHeaterType);
  const poolHeaterType = poolHeaterTypeRaw ?? null;
  if (poolHeaterType && !POOL_HEATER_TYPES.has(poolHeaterType)) return { ok: false, error: "poolHeaterType_invalid" };

  const poolPumpHp = input?.poolPumpHp == null || input?.poolPumpHp === "" ? null : clampFloat(input?.poolPumpHp, 0, 10);
  const poolSummerRunHoursPerDay =
    input?.poolSummerRunHoursPerDay == null || input?.poolSummerRunHoursPerDay === "" ? null : clampFloat(input?.poolSummerRunHoursPerDay, 0, 24);
  const poolWinterRunHoursPerDay =
    input?.poolWinterRunHoursPerDay == null || input?.poolWinterRunHoursPerDay === "" ? null : clampFloat(input?.poolWinterRunHoursPerDay, 0, 24);

  const requirePastBaselineFields = Boolean(opts?.requirePastBaselineFields);
  if (requirePastBaselineFields) {
    if (!hvacType) return { ok: false, error: "hvacType_required" };
    if (!heatingType) return { ok: false, error: "heatingType_required" };
    if (hasPool) {
      if (!poolPumpType) return { ok: false, error: "poolPumpType_required" };
      if (poolPumpHp == null) return { ok: false, error: "poolPumpHp_required" };
      if (poolSummerRunHoursPerDay == null) return { ok: false, error: "poolSummerRunHoursPerDay_required" };
      if (poolWinterRunHoursPerDay == null) return { ok: false, error: "poolWinterRunHoursPerDay_required" };
      if (hasPoolHeater && !poolHeaterType) return { ok: false, error: "poolHeaterType_required" };
    }
  }

  return {
    ok: true,
    value: {
      homeAge,
      homeStyle,
      squareFeet,
      stories,
      insulationType,
      windowType,
      foundation,
      ledLights: Boolean(input?.ledLights),
      smartThermostat: Boolean(input?.smartThermostat),
      summerTemp,
      winterTemp,
      occupantsWork,
      occupantsSchool,
      occupantsHomeAllDay,
      fuelConfiguration,
      hvacType,
      heatingType,
      hasPool,
      poolPumpType,
      poolPumpHp,
      poolSummerRunHoursPerDay,
      poolWinterRunHoursPerDay,
      hasPoolHeater,
      poolHeaterType,
    },
  };
}

