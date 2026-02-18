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

export function validateHomeProfile(input: any): { ok: true; value: HomeProfileInput } | { ok: false; error: string } {
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
    },
  };
}

