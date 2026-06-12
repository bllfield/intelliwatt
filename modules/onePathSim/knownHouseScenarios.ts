import {
  resolveAdminUserUsageSource,
  type AdminUserUsageSource,
} from "@/lib/usage/adminUserUsageSource";

export type OnePathKnownScenarioMode = "INTERVAL" | "GREEN_BUTTON" | "MANUAL_MONTHLY" | "MANUAL_ANNUAL" | "NEW_BUILD";

export type OnePathKnownScenarioType =
  | "INTERVAL_TRUTH"
  | "GREEN_BUTTON_TRUTH"
  | "MANUAL_MONTHLY_TEST"
  | "MANUAL_ANNUAL_TEST"
  | "NEW_BUILD_TEST";

export type OnePathKnownScenarioSelectionStrategy = "baseline" | "scenario_id" | "scenario_name";
export type OnePathKnownHouseSelectionStrategy = "selected_house" | "source_house_id";

export type OnePathKnownScenarioExpectations = {
  expectedBaselineParity?: boolean;
  expectedPastSimCompareAvailable?: boolean;
  expectedMonthlyCompareAvailable?: boolean;
  expectedIntervalCompareAvailable?: boolean;
  targetWapeMax?: number;
  targetMaeMax?: number;
  targetRmseMax?: number;
  knownWeaknessNotes?: string;
};

/** Generic One Path tuning preset — applies to the email/house currently loaded in the harness. */
export type OnePathKnownScenario = {
  scenarioKey: string;
  label: string;
  active: boolean;
  mode: OnePathKnownScenarioMode;
  scenarioType: OnePathKnownScenarioType;
  /** @deprecated Always empty; presets bind to lookup email, not a fixed account. */
  sourceUserEmail: string;
  sourceUserId: string | null;
  sourceHouseId: string | null;
  actualContextHouseId: string | null;
  scenarioId: string | null;
  scenarioNameHint?: string | null;
  scenarioSelectionStrategy: OnePathKnownScenarioSelectionStrategy;
  houseSelectionStrategy: OnePathKnownHouseSelectionStrategy;
  baselineType: "interval_truth" | "green_button_truth" | "manual_monthly" | "manual_annual" | "new_build";
  travelRanges: Array<{ startDate: string; endDate: string }>;
  validationSelectionMode: string | null;
  validationDayCount: number | null;
  validationOnlyDateKeysLocal: string[];
  weatherPreference: "NONE" | "LAST_YEAR_WEATHER" | "LONG_TERM_AVERAGE";
  persistRequested: boolean;
  expectedTruthSource: string;
  expectations?: OnePathKnownScenarioExpectations;
  notes: string;
};

export const DEFAULT_ONE_PATH_SCENARIO_PRESET_KEY = "interval-past-primary";

/** @deprecated Use DEFAULT_ONE_PATH_SCENARIO_PRESET_KEY */
export const DEFAULT_BRIAN_KNOWN_SCENARIO_KEY = DEFAULT_ONE_PATH_SCENARIO_PRESET_KEY;

function buildPreset(
  scenario: Omit<
    OnePathKnownScenario,
    "sourceUserId" | "sourceHouseId" | "actualContextHouseId" | "sourceUserEmail" | "houseSelectionStrategy"
  >
): OnePathKnownScenario {
  return {
    sourceUserId: null,
    sourceHouseId: null,
    actualContextHouseId: null,
    sourceUserEmail: "",
    houseSelectionStrategy: "selected_house",
    ...scenario,
  };
}

type LookupShape = {
  selectedHouse?: { id?: string | null } | null;
  houses?: Array<{ id?: string | null; label?: string | null }> | null;
  scenarios?: Array<{ id?: string | null; name?: string | null }> | null;
};

function normalizeLabel(value: string | null | undefined): string {
  return String(value ?? "").trim().toLowerCase();
}

function matchScenarioIdByHint(
  scenarios: Array<{ id?: string | null; name?: string | null }>,
  scenarioNameHint: string | null | undefined
): string {
  const normalizedHint = normalizeLabel(scenarioNameHint);
  if (!normalizedHint) return "";
  const exact = scenarios.find((scenario) => normalizeLabel(scenario?.name) === normalizedHint);
  if (exact?.id) return String(exact.id);
  const contains = scenarios.find((scenario) => normalizeLabel(scenario?.name).includes(normalizedHint));
  return contains?.id ? String(contains.id) : "";
}

export const ONE_PATH_SCENARIO_PRESETS: OnePathKnownScenario[] = [
  buildPreset({
    scenarioKey: "interval-baseline-primary",
    label: "Interval · Baseline",
    active: true,
    mode: "INTERVAL",
    scenarioType: "INTERVAL_TRUTH",
    scenarioId: null,
    scenarioNameHint: null,
    scenarioSelectionStrategy: "baseline",
    baselineType: "interval_truth",
    travelRanges: [],
    validationSelectionMode: "stratified_weather_balanced",
    validationDayCount: 14,
    validationOnlyDateKeysLocal: [],
    weatherPreference: "LAST_YEAR_WEATHER",
    persistRequested: true,
    expectedTruthSource: "persisted_usage_output",
    expectations: {
      expectedBaselineParity: true,
      expectedPastSimCompareAvailable: false,
      expectedMonthlyCompareAvailable: true,
      expectedIntervalCompareAvailable: false,
    },
    notes: "Usage passthrough baseline for SMT/interval committed homes.",
  }),
  buildPreset({
    scenarioKey: "interval-past-primary",
    label: "Interval · Past Sim",
    active: true,
    mode: "INTERVAL",
    scenarioType: "INTERVAL_TRUTH",
    scenarioId: null,
    scenarioNameHint: "Past (Corrected)",
    scenarioSelectionStrategy: "scenario_name",
    baselineType: "interval_truth",
    travelRanges: [],
    validationSelectionMode: "stratified_weather_balanced",
    validationDayCount: 14,
    validationOnlyDateKeysLocal: [],
    weatherPreference: "LAST_YEAR_WEATHER",
    persistRequested: true,
    expectedTruthSource: "persisted_usage_output",
    expectations: {
      expectedBaselineParity: true,
      expectedPastSimCompareAvailable: true,
      expectedMonthlyCompareAvailable: true,
      expectedIntervalCompareAvailable: true,
      targetWapeMax: 15,
      targetMaeMax: 10,
      targetRmseMax: 15,
    },
    notes: "Primary interval Past preset; fuzzy-matches Past scenario on the loaded house.",
  }),
  buildPreset({
    scenarioKey: "interval-future-primary",
    label: "Interval · Future Sim",
    active: true,
    mode: "INTERVAL",
    scenarioType: "INTERVAL_TRUTH",
    scenarioId: null,
    scenarioNameHint: "Future (What-if)",
    scenarioSelectionStrategy: "scenario_name",
    baselineType: "interval_truth",
    travelRanges: [],
    validationSelectionMode: "stratified_weather_balanced",
    validationDayCount: 14,
    validationOnlyDateKeysLocal: [],
    weatherPreference: "LAST_YEAR_WEATHER",
    persistRequested: true,
    expectedTruthSource: "persisted_usage_output",
    expectations: {
      expectedPastSimCompareAvailable: true,
      expectedMonthlyCompareAvailable: true,
      expectedIntervalCompareAvailable: true,
    },
    notes: "Interval Future checkpoint separate from baseline and Past.",
  }),
  buildPreset({
    scenarioKey: "manual-monthly-baseline-primary",
    label: "Manual monthly · Baseline",
    active: true,
    mode: "MANUAL_MONTHLY",
    scenarioType: "MANUAL_MONTHLY_TEST",
    scenarioId: null,
    scenarioNameHint: null,
    scenarioSelectionStrategy: "baseline",
    baselineType: "manual_monthly",
    travelRanges: [],
    validationSelectionMode: "stratified_weather_balanced",
    validationDayCount: 14,
    validationOnlyDateKeysLocal: [],
    weatherPreference: "LAST_YEAR_WEATHER",
    persistRequested: true,
    expectedTruthSource: "effective_manual_stage_one_payload",
    expectations: {
      expectedBaselineParity: true,
      expectedPastSimCompareAvailable: false,
    },
    notes: "Manual monthly phase-1 / usage-chart passthrough.",
  }),
  buildPreset({
    scenarioKey: "manual-monthly-past-primary",
    label: "Manual monthly · Past Sim",
    active: true,
    mode: "MANUAL_MONTHLY",
    scenarioType: "MANUAL_MONTHLY_TEST",
    scenarioId: null,
    scenarioNameHint: "Past (Corrected)",
    scenarioSelectionStrategy: "scenario_name",
    baselineType: "manual_monthly",
    travelRanges: [],
    validationSelectionMode: "stratified_weather_balanced",
    validationDayCount: 14,
    validationOnlyDateKeysLocal: [],
    weatherPreference: "LAST_YEAR_WEATHER",
    persistRequested: true,
    expectedTruthSource: "effective_manual_stage_one_payload",
    notes: "Manual monthly Past; requires saved manual payload on the loaded house.",
  }),
  buildPreset({
    scenarioKey: "manual-monthly-future-primary",
    label: "Manual monthly · Future Sim",
    active: true,
    mode: "MANUAL_MONTHLY",
    scenarioType: "MANUAL_MONTHLY_TEST",
    scenarioId: null,
    scenarioNameHint: "Future (What-if)",
    scenarioSelectionStrategy: "scenario_name",
    baselineType: "manual_monthly",
    travelRanges: [],
    validationSelectionMode: "stratified_weather_balanced",
    validationDayCount: 14,
    validationOnlyDateKeysLocal: [],
    weatherPreference: "LAST_YEAR_WEATHER",
    persistRequested: true,
    expectedTruthSource: "effective_manual_stage_one_payload",
    notes: "Manual monthly Future checkpoint.",
  }),
  buildPreset({
    scenarioKey: "manual-annual-phase1-primary",
    label: "Manual annual · Phase 1",
    active: true,
    mode: "MANUAL_ANNUAL",
    scenarioType: "MANUAL_ANNUAL_TEST",
    scenarioId: null,
    scenarioNameHint: null,
    scenarioSelectionStrategy: "baseline",
    baselineType: "manual_annual",
    travelRanges: [],
    validationSelectionMode: "stratified_weather_balanced",
    validationDayCount: 14,
    validationOnlyDateKeysLocal: [],
    weatherPreference: "LAST_YEAR_WEATHER",
    persistRequested: true,
    expectedTruthSource: "effective_manual_stage_one_payload",
    expectations: { expectedBaselineParity: true },
    notes: "Manual annual passthrough checkpoint.",
  }),
  buildPreset({
    scenarioKey: "manual-annual-past-primary",
    label: "Manual annual · Past Sim",
    active: true,
    mode: "MANUAL_ANNUAL",
    scenarioType: "MANUAL_ANNUAL_TEST",
    scenarioId: null,
    scenarioNameHint: "Past (Corrected)",
    scenarioSelectionStrategy: "scenario_name",
    baselineType: "manual_annual",
    travelRanges: [],
    validationSelectionMode: "stratified_weather_balanced",
    validationDayCount: 14,
    validationOnlyDateKeysLocal: [],
    weatherPreference: "LAST_YEAR_WEATHER",
    persistRequested: true,
    expectedTruthSource: "effective_manual_stage_one_payload",
    notes: "Manual annual Past; requires annual payload on the loaded house.",
  }),
  buildPreset({
    scenarioKey: "manual-annual-future-primary",
    label: "Manual annual · Future Sim",
    active: true,
    mode: "MANUAL_ANNUAL",
    scenarioType: "MANUAL_ANNUAL_TEST",
    scenarioId: null,
    scenarioNameHint: "Future (What-if)",
    scenarioSelectionStrategy: "scenario_name",
    baselineType: "manual_annual",
    travelRanges: [],
    validationSelectionMode: "stratified_weather_balanced",
    validationDayCount: 14,
    validationOnlyDateKeysLocal: [],
    weatherPreference: "LAST_YEAR_WEATHER",
    persistRequested: true,
    expectedTruthSource: "effective_manual_stage_one_payload",
    notes: "Manual annual Future checkpoint.",
  }),
  buildPreset({
    scenarioKey: "new-build-past-primary",
    label: "New build · Past Sim",
    active: true,
    mode: "NEW_BUILD",
    scenarioType: "NEW_BUILD_TEST",
    scenarioId: null,
    scenarioNameHint: "Past (Corrected)",
    scenarioSelectionStrategy: "scenario_name",
    baselineType: "new_build",
    travelRanges: [],
    validationSelectionMode: "stratified_weather_balanced",
    validationDayCount: 14,
    validationOnlyDateKeysLocal: [],
    weatherPreference: "LAST_YEAR_WEATHER",
    persistRequested: true,
    expectedTruthSource: "new_build_profile_inputs",
    notes: "New build Past; no baseline passthrough.",
  }),
  buildPreset({
    scenarioKey: "new-build-future-primary",
    label: "New build · Future Sim",
    active: true,
    mode: "NEW_BUILD",
    scenarioType: "NEW_BUILD_TEST",
    scenarioId: null,
    scenarioNameHint: "Future (What-if)",
    scenarioSelectionStrategy: "scenario_name",
    baselineType: "new_build",
    travelRanges: [],
    validationSelectionMode: "stratified_weather_balanced",
    validationDayCount: 14,
    validationOnlyDateKeysLocal: [],
    weatherPreference: "LAST_YEAR_WEATHER",
    persistRequested: true,
    expectedTruthSource: "new_build_profile_inputs",
    notes: "New build Future checkpoint.",
  }),
  buildPreset({
    scenarioKey: "green-button-baseline-primary",
    label: "Green Button · Baseline",
    active: true,
    mode: "GREEN_BUTTON",
    scenarioType: "GREEN_BUTTON_TRUTH",
    scenarioId: null,
    scenarioNameHint: null,
    scenarioSelectionStrategy: "baseline",
    baselineType: "green_button_truth",
    travelRanges: [],
    validationSelectionMode: "stratified_weather_balanced",
    validationDayCount: 14,
    validationOnlyDateKeysLocal: [],
    weatherPreference: "LAST_YEAR_WEATHER",
    persistRequested: true,
    expectedTruthSource: "green_button_usage_output",
    expectations: {
      expectedBaselineParity: true,
      expectedPastSimCompareAvailable: false,
      expectedMonthlyCompareAvailable: true,
    },
    notes: "Green Button usage passthrough; load email/house with GB data first.",
  }),
  buildPreset({
    scenarioKey: "green-button-past-primary",
    label: "Green Button · Past Sim",
    active: true,
    mode: "GREEN_BUTTON",
    scenarioType: "GREEN_BUTTON_TRUTH",
    scenarioId: null,
    scenarioNameHint: "Past (Corrected)",
    scenarioSelectionStrategy: "scenario_name",
    baselineType: "green_button_truth",
    travelRanges: [],
    validationSelectionMode: "stratified_weather_balanced",
    validationDayCount: 14,
    validationOnlyDateKeysLocal: [],
    weatherPreference: "LAST_YEAR_WEATHER",
    persistRequested: true,
    expectedTruthSource: "green_button_usage_output",
    expectations: {
      expectedPastSimCompareAvailable: true,
      expectedMonthlyCompareAvailable: true,
      targetWapeMax: 15,
      targetMaeMax: 10,
      targetRmseMax: 15,
    },
    notes: "Green Button Past; actual context should be the source house with GB intervals.",
  }),
  buildPreset({
    scenarioKey: "green-button-future-primary",
    label: "Green Button · Future Sim",
    active: true,
    mode: "GREEN_BUTTON",
    scenarioType: "GREEN_BUTTON_TRUTH",
    scenarioId: null,
    scenarioNameHint: "Future (What-if)",
    scenarioSelectionStrategy: "scenario_name",
    baselineType: "green_button_truth",
    travelRanges: [],
    validationSelectionMode: "stratified_weather_balanced",
    validationDayCount: 14,
    validationOnlyDateKeysLocal: [],
    weatherPreference: "LAST_YEAR_WEATHER",
    persistRequested: true,
    expectedTruthSource: "green_button_usage_output",
    notes: "Green Button Future checkpoint.",
  }),
];

/** @deprecated Use ONE_PATH_SCENARIO_PRESETS */
export const KNOWN_HOUSE_SCENARIOS = ONE_PATH_SCENARIO_PRESETS;

export function isOnePathPastSimPreset(
  scenario: Pick<OnePathKnownScenario, "scenarioSelectionStrategy" | "scenarioNameHint">
): boolean {
  if (scenario.scenarioSelectionStrategy !== "scenario_name") return false;
  const hint = normalizeLabel(scenario.scenarioNameHint);
  return hint.includes("past");
}

const PAST_PRESET_KEY_BY_ADMIN_USAGE_SOURCE: Record<AdminUserUsageSource, string> = {
  SMT: DEFAULT_ONE_PATH_SCENARIO_PRESET_KEY,
  GB: "green-button-past-primary",
  MANUAL_MONTHLY: "manual-monthly-past-primary",
  MANUAL_ANNUAL: "manual-annual-past-primary",
  NEW_BUILD: "new-build-past-primary",
  UNKNOWN: DEFAULT_ONE_PATH_SCENARIO_PRESET_KEY,
};

/** Map admin usage-source classification to the default Past sim preset key. */
export function resolveDefaultPastPresetKeyForAdminUsageSource(source: AdminUserUsageSource): string {
  return PAST_PRESET_KEY_BY_ADMIN_USAGE_SOURCE[source] ?? DEFAULT_ONE_PATH_SCENARIO_PRESET_KEY;
}

/**
 * Default Past preset for One Path lookup — same usage-source priority as the admin user table
 * (`resolveAdminUserUsageSource`): committed SMT/GB wins over stale manual payload rows.
 */
export function resolveDefaultPastPresetKeyForLookupSourceContext(args: {
  committedUsageSource?: "SMT" | "GREEN_BUTTON" | null;
  manualUsageMode?: string | null;
  simulatorMode?: string | null;
}): string {
  const usageSource = resolveAdminUserUsageSource({
    committedUsageSource: args.committedUsageSource,
    manualUsageMode: args.manualUsageMode,
    simulatorMode: args.simulatorMode,
  });
  return resolveDefaultPastPresetKeyForAdminUsageSource(usageSource);
}

/** @deprecated Prefer resolveDefaultPastPresetKeyForLookupSourceContext */
export function resolveDefaultPastPresetKeyForCommittedSource(args: {
  committedUsageSource?: "SMT" | "GREEN_BUTTON" | null;
  manualUsageMode?: string | null;
}): string {
  return resolveDefaultPastPresetKeyForLookupSourceContext(args);
}

export function getKnownHouseScenarioByKey(scenarioKey: string | null | undefined): OnePathKnownScenario | null {
  if (!scenarioKey) return null;
  const legacyKey =
    scenarioKey === "keeper-interval-past-primary"
      ? "interval-past-primary"
      : scenarioKey === "keeper-brian-interval-baseline-primary"
        ? "interval-baseline-primary"
        : scenarioKey === "keeper-brian-interval-future-primary"
          ? "interval-future-primary"
          : scenarioKey === "keeper-manual-monthly-baseline-primary"
            ? "manual-monthly-baseline-primary"
            : scenarioKey === "keeper-manual-monthly-past-primary"
              ? "manual-monthly-past-primary"
              : scenarioKey === "keeper-manual-monthly-future-primary"
                ? "manual-monthly-future-primary"
                : scenarioKey === "keeper-manual-annual-phase1-primary"
                  ? "manual-annual-phase1-primary"
                  : scenarioKey === "keeper-manual-annual-past-primary"
                    ? "manual-annual-past-primary"
                    : scenarioKey === "keeper-manual-annual-future-primary"
                      ? "manual-annual-future-primary"
                      : scenarioKey === "keeper-new-build-past-primary"
                        ? "new-build-past-primary"
                        : scenarioKey === "keeper-new-build-future-primary"
                          ? "new-build-future-primary"
                          : scenarioKey === "keeper-green-button-baseline-primary"
                            ? "green-button-baseline-primary"
                            : scenarioKey === "keeper-green-button-past-primary"
                              ? "green-button-past-primary"
                              : scenarioKey === "keeper-green-button-future-primary"
                                ? "green-button-future-primary"
                                : scenarioKey === "keeper-fort-worth-green-button-baseline-primary"
                                  ? "green-button-baseline-primary"
                                  : scenarioKey === "keeper-fort-worth-green-button-past-primary"
                                    ? "green-button-past-primary"
                                    : scenarioKey;
  return ONE_PATH_SCENARIO_PRESETS.find((scenario) => scenario.scenarioKey === legacyKey) ?? null;
}

export function resolveKnownHouseScenarioSelection(args: {
  scenario: Pick<
    OnePathKnownScenario,
    "sourceHouseId" | "actualContextHouseId" | "scenarioId" | "scenarioNameHint" | "scenarioSelectionStrategy" | "houseSelectionStrategy"
  >;
  lookup: LookupShape;
}): {
  selectedHouseId: string;
  actualContextHouseId: string;
  selectedScenarioId: string;
} {
  const houses = Array.isArray(args.lookup.houses) ? args.lookup.houses : [];
  const scenarios = Array.isArray(args.lookup.scenarios) ? args.lookup.scenarios : [];
  const lookupSelectedId = String(args.lookup.selectedHouse?.id ?? "").trim();
  const selectedHouseId =
    args.scenario.houseSelectionStrategy === "source_house_id" && args.scenario.sourceHouseId
      ? houses.find((house) => String(house?.id ?? "") === args.scenario.sourceHouseId)?.id ?? args.scenario.sourceHouseId
      : lookupSelectedId || args.scenario.sourceHouseId || "";
  const actualContextHouseId =
    String(args.scenario.actualContextHouseId ?? "").trim() || String(selectedHouseId ?? "").trim() || lookupSelectedId;
  const selectedScenarioId =
    args.scenario.scenarioSelectionStrategy === "scenario_id"
      ? args.scenario.scenarioId ?? ""
      : args.scenario.scenarioSelectionStrategy === "scenario_name"
        ? matchScenarioIdByHint(scenarios, args.scenario.scenarioNameHint)
        : "";

  return {
    selectedHouseId: String(selectedHouseId ?? ""),
    actualContextHouseId: String(actualContextHouseId ?? ""),
    selectedScenarioId: String(selectedScenarioId ?? ""),
  };
}
