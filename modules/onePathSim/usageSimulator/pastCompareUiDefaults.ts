/** User Past Sim: Validation / Test Day Compare section starts collapsed (expand to see table + full metrics). */
export const PAST_VALIDATION_COMPARE_DEFAULT_EXPANDED = false;

/** When true, Past Validation/Test compare expand state resets to the default (collapsed). Used when the user lands on the Past curve tab. */
export function shouldResetPastValidationCompareExpanded(
  curveView: "BASELINE" | "PAST" | "FUTURE"
): boolean {
  return curveView === "PAST";
}

