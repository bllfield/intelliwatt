/** Derive 15-minute baseload kWh and average kW from a daily baseload total. */
export function deriveBaseloadFieldsFromDaily(baseloadDailyKwh: number | null | undefined): {
  baseload15MinKwh: number | null;
  baseloadAvgKw: number | null;
} {
  if (baseloadDailyKwh == null || !Number.isFinite(Number(baseloadDailyKwh))) {
    return { baseload15MinKwh: null, baseloadAvgKw: null };
  }
  const daily = Number(baseloadDailyKwh);
  return {
    baseload15MinKwh: Number((daily / 96).toFixed(4)),
    baseloadAvgKw: Number((daily / 24).toFixed(4)),
  };
}
