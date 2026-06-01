/**
 * Past-sim days tagged INCOMPLETE_METER_DAY still carry interval consumption on the stitched
 * curve (e.g. Green Button trusted shifted reads). Exclude only modeled non-meter days from
 * FILTERED_NORMAL_LIFE_V1 15-minute baseload.
 */
const SIMULATED_REASON_CODES_EXCLUDED_FROM_BASELOAD = new Set([
  "TRAVEL_VACANT",
  "TEST_MODELED_KEEP_REF",
  "FORCED_SELECTED_DAY",
  "MANUAL_CONSTRAINED_DAY",
  "MONTHLY_CONSTRAINED_NON_TRAVEL_DAY",
  "INTERVALS_NOT_AVAILABLE_YET_DAY",
  "DAILY_USAGE_MISSING_DAY",
  "LEADING_MISSING_DAY",
]);

export function buildSimulatedHomeDateKeysExcludedFromBaseload(
  simulatedDayResults: Array<{ localDate?: string; simulatedReasonCode?: string }> | undefined
): Set<string> | undefined {
  const keys = new Set<string>();
  for (const row of simulatedDayResults ?? []) {
    const dk = String(row?.localDate ?? "").slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dk)) continue;
    const code = String(row?.simulatedReasonCode ?? "");
    if (!code || SIMULATED_REASON_CODES_EXCLUDED_FROM_BASELOAD.has(code)) {
      keys.add(dk);
      continue;
    }
    // INCOMPLETE_METER_DAY and any future modeled codes default to included in baseload pool.
  }
  return keys.size > 0 ? keys : undefined;
}
