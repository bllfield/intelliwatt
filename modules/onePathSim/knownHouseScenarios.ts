export type OnePathKnownScenarioMode = "INTERVAL" | "MANUAL_MONTHLY" | "MANUAL_ANNUAL" | "NEW_BUILD";

export type OnePathKnownScenarioType =
  | "INTERVAL_TRUTH"
  | "MANUAL_MONTHLY_TEST"
  | "MANUAL_ANNUAL_TEST"
  | "NEW_BUILD_OPTIONAL";

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

export type OnePathKnownScenario = {
  scenarioKey: string;
  label: string;
  active: boolean;
  mode: OnePathKnownScenarioMode;
  scenarioType: OnePathKnownScenarioType;
  sourceUserEmail: string;
  sourceUserId: string | null;
  sourceHouseId: string | null;
  actualContextHouseId: string | null;
  scenarioId: string | null;
  scenarioNameHint?: string | null;
  scenarioSelectionStrategy: OnePathKnownScenarioSelectionStrategy;
  houseSelectionStrategy: OnePathKnownHouseSelectionStrategy;
  baselineType: "interval_truth" | "manual_monthly" | "manual_annual" | "new_build_optional";
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

type LookupShape = {
  selectedHouse?: { id?: string | null } | null;
  houses?: Array<{ id?: string | null; label?: string | null }> | null;
  scenarios?: Array<{ id?: string | null; name?: string | null }> | null;
};

function normalizeLabel(value: string | null | undefined): string {
  return String(value ?? "").trim().toLowerCase();
}

export const KNOWN_HOUSE_SCENARIOS: OnePathKnownScenario[] = [
  {
    scenarioKey: "keeper-interval-baseline-primary",
    label: "Keeper interval baseline primary",
    active: true,
    mode: "INTERVAL",
    scenarioType: "INTERVAL_TRUTH",
    sourceUserEmail: "omoneo@o2epcm.com",
    sourceUserId: null,
    sourceHouseId: null,
    actualContextHouseId: null,
    scenarioId: null,
    scenarioNameHint: null,
    scenarioSelectionStrategy: "baseline",
    houseSelectionStrategy: "selected_house",
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
      knownWeaknessNotes: "Baseline only; use the paired Past preset for curve/compare tuning.",
    },
    notes:
      "Starter keeper-house interval baseline preset. It relies on the selected house returned by lookup so the harness stays code-backed and sandbox-only.",
  },
  {
    scenarioKey: "keeper-interval-past-primary",
    label: "Keeper interval Past Sim primary",
    active: true,
    mode: "INTERVAL",
    scenarioType: "INTERVAL_TRUTH",
    sourceUserEmail: "omoneo@o2epcm.com",
    sourceUserId: null,
    sourceHouseId: null,
    actualContextHouseId: null,
    scenarioId: null,
    scenarioNameHint: "Past",
    scenarioSelectionStrategy: "scenario_name",
    houseSelectionStrategy: "selected_house",
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
    notes:
      "Primary repeated-tuning interval preset. Loads the named Past scenario after lookup so compare metrics, daily shape, and interval shape stay one click away.",
  },
  {
    scenarioKey: "keeper-manual-monthly-primary",
    label: "Keeper manual monthly primary",
    active: true,
    mode: "MANUAL_MONTHLY",
    scenarioType: "MANUAL_MONTHLY_TEST",
    sourceUserEmail: "cgoldstein@seia.com",
    sourceUserId: null,
    sourceHouseId: null,
    actualContextHouseId: null,
    scenarioId: null,
    scenarioNameHint: "Past",
    scenarioSelectionStrategy: "scenario_name",
    houseSelectionStrategy: "selected_house",
    baselineType: "manual_monthly",
    travelRanges: [],
    validationSelectionMode: "stratified_weather_balanced",
    validationDayCount: 14,
    validationOnlyDateKeysLocal: [],
    weatherPreference: "LAST_YEAR_WEATHER",
    persistRequested: true,
    expectedTruthSource: "saved_manual_usage_payload",
    expectations: {
      expectedBaselineParity: true,
      expectedPastSimCompareAvailable: true,
      expectedMonthlyCompareAvailable: true,
      expectedIntervalCompareAvailable: true,
      targetWapeMax: 20,
      targetMaeMax: 12,
      knownWeaknessNotes: "Requires saved manual monthly payload on the keeper house before the run.",
    },
    notes:
      "Manual-monthly repeated-tuning starter. Uses saved manual payload truth plus the named Past scenario when available.",
  },
  {
    scenarioKey: "keeper-manual-annual-primary",
    label: "Keeper manual annual primary",
    active: true,
    mode: "MANUAL_ANNUAL",
    scenarioType: "MANUAL_ANNUAL_TEST",
    sourceUserEmail: "whill@hilltrans.com",
    sourceUserId: null,
    sourceHouseId: null,
    actualContextHouseId: null,
    scenarioId: null,
    scenarioNameHint: "Past",
    scenarioSelectionStrategy: "scenario_name",
    houseSelectionStrategy: "selected_house",
    baselineType: "manual_annual",
    travelRanges: [],
    validationSelectionMode: "stratified_weather_balanced",
    validationDayCount: 14,
    validationOnlyDateKeysLocal: [],
    weatherPreference: "LAST_YEAR_WEATHER",
    persistRequested: true,
    expectedTruthSource: "saved_manual_usage_payload",
    expectations: {
      expectedBaselineParity: true,
      expectedPastSimCompareAvailable: true,
      expectedMonthlyCompareAvailable: true,
      expectedIntervalCompareAvailable: true,
      targetWapeMax: 20,
      targetMaeMax: 12,
      knownWeaknessNotes: "Requires saved manual annual payload on the keeper house before the run.",
    },
    notes:
      "Manual-annual repeated-tuning starter. Preserves the saved annual truth contract while still resolving the same sandbox compare surfaces.",
  },
  {
    scenarioKey: "keeper-new-build-optional",
    label: "Keeper new-build optional starter",
    active: false,
    mode: "NEW_BUILD",
    scenarioType: "NEW_BUILD_OPTIONAL",
    sourceUserEmail: "zander86@gmail.com",
    sourceUserId: null,
    sourceHouseId: null,
    actualContextHouseId: null,
    scenarioId: null,
    scenarioNameHint: "Past",
    scenarioSelectionStrategy: "scenario_name",
    houseSelectionStrategy: "selected_house",
    baselineType: "new_build_optional",
    travelRanges: [],
    validationSelectionMode: "stratified_weather_balanced",
    validationDayCount: 14,
    validationOnlyDateKeysLocal: [],
    weatherPreference: "LAST_YEAR_WEATHER",
    persistRequested: true,
    expectedTruthSource: "new_build_profile_inputs",
    expectations: {
      expectedBaselineParity: false,
      expectedPastSimCompareAvailable: true,
      expectedMonthlyCompareAvailable: true,
      expectedIntervalCompareAvailable: true,
      knownWeaknessNotes: "Optional starter only; activate when the keeper house has sufficient new-build profile truth.",
    },
    notes:
      "Optional new-build starter kept inactive by default until the sandbox truth set is confirmed strong enough for repeated tuning.",
  },
];

export function getKnownHouseScenarioByKey(scenarioKey: string | null | undefined): OnePathKnownScenario | null {
  if (!scenarioKey) return null;
  return KNOWN_HOUSE_SCENARIOS.find((scenario) => scenario.scenarioKey === scenarioKey) ?? null;
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
  const selectedHouseId =
    args.scenario.houseSelectionStrategy === "source_house_id" && args.scenario.sourceHouseId
      ? houses.find((house) => String(house?.id ?? "") === args.scenario.sourceHouseId)?.id ?? args.scenario.sourceHouseId
      : args.lookup.selectedHouse?.id ?? args.scenario.sourceHouseId ?? "";
  const actualContextHouseId = args.scenario.actualContextHouseId ?? selectedHouseId ?? "";
  const selectedScenarioId =
    args.scenario.scenarioSelectionStrategy === "scenario_id"
      ? args.scenario.scenarioId ?? ""
      : args.scenario.scenarioSelectionStrategy === "scenario_name"
        ? (scenarios.find((scenario) => normalizeLabel(scenario?.name) === normalizeLabel(args.scenario.scenarioNameHint))?.id ?? "")
        : "";

  return {
    selectedHouseId: String(selectedHouseId ?? ""),
    actualContextHouseId: String(actualContextHouseId ?? ""),
    selectedScenarioId: String(selectedScenarioId ?? ""),
  };
}
