/**
 * GapFill compare_core must always request canonical simulator-owned scored-day totals for fresh
 * diagnostics (selected_days and full_window). Compare truth stays artifact-backed; this flag only
 * enables canonical totals for `freshCompareScoredDaySimTotalsByDate` parity/diagnostics.
 * When true, `buildGapfillCompareSimShared` fails closed (HTTP 500,
 * `FRESH_COMPARE_CANONICAL_DAY_TOTALS_MISSING`) if any scored test day lacks canonical totals — no
 * interval-sum substitute for fresh diagnostics.
 * @see AUTHORITATIVE SIMULATOR ARCHITECTURE OVERRIDE §8 (USAGE_SIMULATION_PLAN / PROJECT_PLAN).
 */
export const INCLUDE_FRESH_COMPARE_CALC_IN_GAPFILL_COMPARE_CORE = true as const;

