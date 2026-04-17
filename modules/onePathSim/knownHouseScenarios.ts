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

export const PRIMARY_BRIAN_SANDBOX_CONTEXT = {
  email: "brian@intellipath-solutions.com",
  houseId: "8a6fe8b9-601e-4f9d-aa3e-7ef0b4bddde8",
  actualContextHouseId: "8a6fe8b9-601e-4f9d-aa3e-7ef0b4bddde8",
  houseLabel: "146 Valley View Drive, Lewisville, TX (10400511114390001)",
} as const;

export const DEFAULT_BRIAN_KNOWN_SCENARIO_KEY = "keeper-interval-past-primary";

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

export const KNOWN_HOUSE_SCENARIOS: OnePathKnownScenario[] = [
  {
    scenarioKey: "keeper-brian-interval-baseline-primary",
    label: "Brian interval baseline primary",
    active: true,
    mode: "INTERVAL",
    scenarioType: "INTERVAL_TRUTH",
    sourceUserEmail: PRIMARY_BRIAN_SANDBOX_CONTEXT.email,
    sourceUserId: null,
    sourceHouseId: PRIMARY_BRIAN_SANDBOX_CONTEXT.houseId,
    actualContextHouseId: PRIMARY_BRIAN_SANDBOX_CONTEXT.actualContextHouseId,
    scenarioId: null,
    scenarioNameHint: null,
    scenarioSelectionStrategy: "baseline",
    houseSelectionStrategy: "source_house_id",
    baselineType: "interval_truth",
    travelRanges: [
      { startDate: "2025-03-14", endDate: "2025-06-01" },
      { startDate: "2025-08-13", endDate: "2025-08-17" },
    ],
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
      knownWeaknessNotes: "Brian baseline is the primary sandbox truth control before any Past compare run.",
    },
    notes:
      "Primary Brian baseline control preset. This uses the resolved Brian sandbox house/context directly so the first tuning cycle starts from the same house every time.",
  },
  {
    scenarioKey: "keeper-interval-baseline-primary",
    label: "Sample-home interval baseline primary",
    active: true,
    mode: "INTERVAL",
    scenarioType: "INTERVAL_TRUTH",
    sourceUserEmail: "bllfield32@gmail.com",
    sourceUserId: null,
    sourceHouseId: "2a71f4f1-3671-4b7f-a856-f456b60496a1",
    actualContextHouseId: "2a71f4f1-3671-4b7f-a856-f456b60496a1",
    scenarioId: null,
    scenarioNameHint: null,
    scenarioSelectionStrategy: "baseline",
    houseSelectionStrategy: "source_house_id",
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
      knownWeaknessNotes: "Baseline-only sample home with persisted SMT truth and no paired Past scenario yet.",
    },
    notes:
      "Stable sample-home interval baseline preset for the first real sandbox tuning cycle. It binds to one known SMT-backed house so baseline parity stays repeatable.",
  },
  {
    scenarioKey: "keeper-interval-past-primary",
    label: "Brian interval Past Sim primary",
    active: true,
    mode: "INTERVAL",
    scenarioType: "INTERVAL_TRUTH",
    sourceUserEmail: PRIMARY_BRIAN_SANDBOX_CONTEXT.email,
    sourceUserId: null,
    sourceHouseId: PRIMARY_BRIAN_SANDBOX_CONTEXT.houseId,
    actualContextHouseId: PRIMARY_BRIAN_SANDBOX_CONTEXT.actualContextHouseId,
    scenarioId: null,
    scenarioNameHint: "Past",
    scenarioSelectionStrategy: "scenario_name",
    houseSelectionStrategy: "source_house_id",
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
      targetWapeMax: 15,
      targetMaeMax: 10,
      targetRmseMax: 15,
      knownWeaknessNotes:
        "Current cycle shows the Past run is blocked until shared Home Details are completed on the bound sandbox house.",
    },
    notes:
      "Primary repeated-tuning interval preset for the real sandbox cycle. It targets the Brian sandbox house and fuzzy-matches the Past scenario name after lookup.",
  },
  {
    scenarioKey: "keeper-manual-monthly-primary",
    label: "Brian manual monthly primary",
    active: true,
    mode: "MANUAL_MONTHLY",
    scenarioType: "MANUAL_MONTHLY_TEST",
    sourceUserEmail: PRIMARY_BRIAN_SANDBOX_CONTEXT.email,
    sourceUserId: null,
    sourceHouseId: PRIMARY_BRIAN_SANDBOX_CONTEXT.houseId,
    actualContextHouseId: PRIMARY_BRIAN_SANDBOX_CONTEXT.actualContextHouseId,
    scenarioId: null,
    scenarioNameHint: "Past",
    scenarioSelectionStrategy: "scenario_name",
    houseSelectionStrategy: "source_house_id",
    baselineType: "manual_monthly",
    travelRanges: [
      { startDate: "2025-03-14", endDate: "2025-06-01" },
      { startDate: "2025-08-13", endDate: "2025-08-17" },
    ],
    validationSelectionMode: "stratified_weather_balanced",
    validationDayCount: 14,
    validationOnlyDateKeysLocal: [],
    weatherPreference: "LAST_YEAR_WEATHER",
    persistRequested: true,
    expectedTruthSource: "saved_manual_usage_payload",
    expectations: {
      expectedBaselineParity: true,
      expectedPastSimCompareAvailable: false,
      expectedMonthlyCompareAvailable: false,
      expectedIntervalCompareAvailable: false,
      targetWapeMax: 20,
      targetMaeMax: 12,
      knownWeaknessNotes:
        "Current cycle shows the saved monthly payload is present but not filled, and the shared Home Details / Appliances prerequisites still block Past Sim.",
    },
    notes:
      "Manual-monthly repeated-tuning preset for the Brian sandbox house. It preserves the saved monthly payload and shared travel ranges for repeatable readiness checks.",
  },
  {
    scenarioKey: "keeper-manual-annual-baseline-primary",
    label: "Brian manual annual baseline primary",
    active: true,
    mode: "MANUAL_ANNUAL",
    scenarioType: "MANUAL_ANNUAL_TEST",
    sourceUserEmail: PRIMARY_BRIAN_SANDBOX_CONTEXT.email,
    sourceUserId: null,
    sourceHouseId: PRIMARY_BRIAN_SANDBOX_CONTEXT.houseId,
    actualContextHouseId: PRIMARY_BRIAN_SANDBOX_CONTEXT.actualContextHouseId,
    scenarioId: null,
    scenarioNameHint: null,
    scenarioSelectionStrategy: "baseline",
    houseSelectionStrategy: "source_house_id",
    baselineType: "manual_annual",
    travelRanges: [
      { startDate: "2025-03-14", endDate: "2025-06-01" },
      { startDate: "2025-08-13", endDate: "2025-08-17" },
    ],
    validationSelectionMode: "stratified_weather_balanced",
    validationDayCount: 14,
    validationOnlyDateKeysLocal: [],
    weatherPreference: "LAST_YEAR_WEATHER",
    persistRequested: true,
    expectedTruthSource: "saved_manual_usage_payload",
    expectations: {
      expectedBaselineParity: true,
      expectedPastSimCompareAvailable: false,
      expectedMonthlyCompareAvailable: false,
      expectedIntervalCompareAvailable: false,
      targetWapeMax: 20,
      targetMaeMax: 12,
      knownWeaknessNotes:
        "This preset is a guardrail run until the sandbox house has a real saved MANUAL_ANNUAL payload. The lockbox should now fail instead of fabricating a zeroed annual baseline.",
    },
    notes:
      "Manual-annual baseline preset for the Brian sandbox house. It is the primary annual passthrough readiness check for the tuning cycle.",
  },
  {
    scenarioKey: "keeper-manual-annual-past-primary",
    label: "Brian manual annual Past primary",
    active: true,
    mode: "MANUAL_ANNUAL",
    scenarioType: "MANUAL_ANNUAL_TEST",
    sourceUserEmail: PRIMARY_BRIAN_SANDBOX_CONTEXT.email,
    sourceUserId: null,
    sourceHouseId: PRIMARY_BRIAN_SANDBOX_CONTEXT.houseId,
    actualContextHouseId: PRIMARY_BRIAN_SANDBOX_CONTEXT.actualContextHouseId,
    scenarioId: null,
    scenarioNameHint: "Past",
    scenarioSelectionStrategy: "scenario_name",
    houseSelectionStrategy: "source_house_id",
    baselineType: "manual_annual",
    travelRanges: [
      { startDate: "2025-03-14", endDate: "2025-06-01" },
      { startDate: "2025-08-13", endDate: "2025-08-17" },
    ],
    validationSelectionMode: "stratified_weather_balanced",
    validationDayCount: 14,
    validationOnlyDateKeysLocal: [],
    weatherPreference: "LAST_YEAR_WEATHER",
    persistRequested: true,
    expectedTruthSource: "saved_manual_usage_payload",
    expectations: {
      expectedBaselineParity: false,
      expectedPastSimCompareAvailable: false,
      expectedMonthlyCompareAvailable: false,
      expectedIntervalCompareAvailable: false,
      targetWapeMax: 20,
      targetMaeMax: 12,
      knownWeaknessNotes:
        "This preset remains blocked until Brian's sandbox house has a real MANUAL_ANNUAL payload plus completed shared prerequisite data.",
    },
    notes:
      "Manual-annual Past preset for the Brian sandbox house. It is separate from the annual baseline preset so annual passthrough and annual compare readiness stay explicit.",
  },
  {
    scenarioKey: "keeper-new-build-optional",
    label: "Brian new-build optional starter",
    active: false,
    mode: "NEW_BUILD",
    scenarioType: "NEW_BUILD_OPTIONAL",
    sourceUserEmail: PRIMARY_BRIAN_SANDBOX_CONTEXT.email,
    sourceUserId: null,
    sourceHouseId: PRIMARY_BRIAN_SANDBOX_CONTEXT.houseId,
    actualContextHouseId: PRIMARY_BRIAN_SANDBOX_CONTEXT.actualContextHouseId,
    scenarioId: null,
    scenarioNameHint: "Past",
    scenarioSelectionStrategy: "scenario_name",
    houseSelectionStrategy: "source_house_id",
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
      "Optional new-build starter bound to the Brian sandbox house and kept inactive until the sandbox truth set is confirmed strong enough for repeated tuning.",
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
        ? matchScenarioIdByHint(scenarios, args.scenario.scenarioNameHint)
        : "";

  return {
    selectedHouseId: String(selectedHouseId ?? ""),
    actualContextHouseId: String(actualContextHouseId ?? ""),
    selectedScenarioId: String(selectedScenarioId ?? ""),
  };
}
