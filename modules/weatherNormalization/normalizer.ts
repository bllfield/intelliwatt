export const WEATHER_NORMALIZER_VERSION = "v1";

export type WeatherPreference = "NONE" | "LAST_YEAR_WEATHER" | "LONG_TERM_AVERAGE";

export function normalizeMonthlyTotals(args: {
  canonicalMonths: string[];
  monthlyTotalsKwhByMonth: Record<string, number>;
  preference: WeatherPreference;
}): { monthlyTotalsKwhByMonth: Record<string, number>; notes: string[] } {
  const preference = args.preference;
  if (preference === "NONE") return { monthlyTotalsKwhByMonth: args.monthlyTotalsKwhByMonth, notes: [] };

  // Phase 1 identity behavior: preference is persisted + hashed, but does not change totals yet.
  return {
    monthlyTotalsKwhByMonth: args.monthlyTotalsKwhByMonth,
    notes: [`Weather normalization preference saved (${preference}); Phase 1 behavior is identity.`],
  };
}

