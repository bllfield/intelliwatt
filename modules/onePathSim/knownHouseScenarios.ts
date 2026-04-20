export type OnePathKnownScenarioMode = "INTERVAL" | "MANUAL_MONTHLY" | "MANUAL_ANNUAL" | "NEW_BUILD";

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

export const PRIMARY_BRIAN_SANDBOX_CONTEXT = {
  email: "brian@intellipath-solutions.com",
  houseId: "8a6fe8b9-601e-4f9d-aa3e-7ef0b4bddde8",
  actualContextHouseId: "8a6fe8b9-601e-4f9d-aa3e-7ef0b4bddde8",
  houseLabel: "146 Valley View Drive, Lewisville, TX (10400511114390001)",
} as const;

export const DEFAULT_BRIAN_KNOWN_SCENARIO_KEY = "keeper-interval-past-primary";

const PRIMARY_INTERVAL_TRAVEL_RANGES = [
  { startDate: "2025-03-14", endDate: "2025-06-01" },
  { startDate: "2025-08-13", endDate: "2025-08-17" },
] as const;

function buildKnownScenario(
  scenario: Omit<OnePathKnownScenario, "sourceUserId" | "sourceHouseId" | "actualContextHouseId">
): OnePathKnownScenario {
  return {
    sourceUserId: null,
    sourceHouseId: PRIMARY_BRIAN_SANDBOX_CONTEXT.houseId,
    actualContextHouseId: PRIMARY_BRIAN_SANDBOX_CONTEXT.actualContextHouseId,
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

export const KNOWN_HOUSE_SCENARIOS: OnePathKnownScenario[] = [
  buildKnownScenario({
    scenarioKey: "keeper-brian-interval-baseline-primary",
    label: "Brian interval baseline primary",
    active: true,
    mode: "INTERVAL",
    scenarioType: "INTERVAL_TRUTH",
    sourceUserEmail: PRIMARY_BRIAN_SANDBOX_CONTEXT.email,
    scenarioId: null,
    scenarioNameHint: null,
    scenarioSelectionStrategy: "baseline",
    houseSelectionStrategy: "source_house_id",
    baselineType: "interval_truth",
    travelRanges: [...PRIMARY_INTERVAL_TRAVEL_RANGES],
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
  }),
  buildKnownScenario({
    scenarioKey: "keeper-interval-past-primary",
    label: "Brian interval Past Sim primary",
    active: true,
    mode: "INTERVAL",
    scenarioType: "INTERVAL_TRUTH",
    sourceUserEmail: PRIMARY_BRIAN_SANDBOX_CONTEXT.email,
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
  }),
  buildKnownScenario({
    scenarioKey: "keeper-brian-interval-future-primary",
    label: "Brian interval Future Sim primary",
    active: true,
    mode: "INTERVAL",
    scenarioType: "INTERVAL_TRUTH",
    sourceUserEmail: PRIMARY_BRIAN_SANDBOX_CONTEXT.email,
    scenarioId: null,
    scenarioNameHint: "Future",
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
      expectedBaselineParity: false,
      expectedPastSimCompareAvailable: true,
      expectedMonthlyCompareAvailable: true,
      expectedIntervalCompareAvailable: true,
      targetWapeMax: 15,
      targetMaeMax: 10,
      targetRmseMax: 15,
      knownWeaknessNotes:
        "Future tuning should stay explicit and separate from baseline passthrough so comparison drift is visible against the same keeper context.",
    },
    notes:
      "Primary repeated-tuning interval Future preset for the Brian sandbox house. It fuzzy-matches the Future scenario name after lookup.",
  }),
  buildKnownScenario({
    scenarioKey: "keeper-manual-monthly-baseline-primary",
    label: "Brian manual monthly baseline / phase 1 primary",
    active: true,
    mode: "MANUAL_MONTHLY",
    scenarioType: "MANUAL_MONTHLY_TEST",
    sourceUserEmail: PRIMARY_BRIAN_SANDBOX_CONTEXT.email,
    scenarioId: null,
    scenarioNameHint: null,
    scenarioSelectionStrategy: "baseline",
    houseSelectionStrategy: "source_house_id",
    baselineType: "manual_monthly",
    travelRanges: [...PRIMARY_INTERVAL_TRAVEL_RANGES],
    validationSelectionMode: "stratified_weather_balanced",
    validationDayCount: 14,
    validationOnlyDateKeysLocal: [],
    weatherPreference: "LAST_YEAR_WEATHER",
    persistRequested: true,
    expectedTruthSource: "effective_manual_stage_one_payload",
    expectations: {
      expectedBaselineParity: true,
      expectedPastSimCompareAvailable: false,
      expectedMonthlyCompareAvailable: false,
      expectedIntervalCompareAvailable: false,
      targetWapeMax: 20,
      targetMaeMax: 12,
      knownWeaknessNotes:
        "This preset is the passthrough usage-chart / phase-1 check. The saved manual monthly payload remains the Stage 1 truth while baseline stays usage passthrough only.",
    },
    notes:
      "Manual-monthly baseline preset for the Brian sandbox house. Use it as the phase-1 / usage-chart passthrough checkpoint before Past or Future simulation.",
  }),
  buildKnownScenario({
    scenarioKey: "keeper-manual-monthly-past-primary",
    label: "Brian manual monthly Past Sim primary",
    active: true,
    mode: "MANUAL_MONTHLY",
    scenarioType: "MANUAL_MONTHLY_TEST",
    sourceUserEmail: PRIMARY_BRIAN_SANDBOX_CONTEXT.email,
    scenarioId: null,
    scenarioNameHint: "Past",
    scenarioSelectionStrategy: "scenario_name",
    houseSelectionStrategy: "source_house_id",
    baselineType: "manual_monthly",
    travelRanges: [...PRIMARY_INTERVAL_TRAVEL_RANGES],
    validationSelectionMode: "stratified_weather_balanced",
    validationDayCount: 14,
    validationOnlyDateKeysLocal: [],
    weatherPreference: "LAST_YEAR_WEATHER",
    persistRequested: true,
    expectedTruthSource: "effective_manual_stage_one_payload",
    expectations: {
      expectedBaselineParity: false,
      expectedPastSimCompareAvailable: false,
      expectedMonthlyCompareAvailable: false,
      expectedIntervalCompareAvailable: false,
      targetWapeMax: 20,
      targetMaeMax: 12,
      knownWeaknessNotes:
        "Current cycle shows the saved monthly payload is present but not filled, and the shared Home Details / Appliances prerequisites still block Past Sim.",
    },
    notes:
      "Manual-monthly Past preset for the Brian sandbox house. It keeps the saved manual payload plus shared travel ranges attached for repeatable tuning checks.",
  }),
  buildKnownScenario({
    scenarioKey: "keeper-manual-monthly-future-primary",
    label: "Brian manual monthly Future Sim primary",
    active: true,
    mode: "MANUAL_MONTHLY",
    scenarioType: "MANUAL_MONTHLY_TEST",
    sourceUserEmail: PRIMARY_BRIAN_SANDBOX_CONTEXT.email,
    scenarioId: null,
    scenarioNameHint: "Future",
    scenarioSelectionStrategy: "scenario_name",
    houseSelectionStrategy: "source_house_id",
    baselineType: "manual_monthly",
    travelRanges: [...PRIMARY_INTERVAL_TRAVEL_RANGES],
    validationSelectionMode: "stratified_weather_balanced",
    validationDayCount: 14,
    validationOnlyDateKeysLocal: [],
    weatherPreference: "LAST_YEAR_WEATHER",
    persistRequested: true,
    expectedTruthSource: "effective_manual_stage_one_payload",
    expectations: {
      expectedBaselineParity: false,
      expectedPastSimCompareAvailable: true,
      expectedMonthlyCompareAvailable: true,
      expectedIntervalCompareAvailable: true,
      targetWapeMax: 20,
      targetMaeMax: 12,
      knownWeaknessNotes:
        "Future manual-monthly tuning should stay separate from the phase-1 passthrough checkpoint so stage-2 drift remains explicit.",
    },
    notes:
      "Manual-monthly Future preset for the Brian sandbox house. It keeps future sim runs distinct from both baseline passthrough and Past Sim tuning.",
  }),
  buildKnownScenario({
    scenarioKey: "keeper-manual-annual-phase1-primary",
    label: "Brian manual annual phase 1 primary",
    active: true,
    mode: "MANUAL_ANNUAL",
    scenarioType: "MANUAL_ANNUAL_TEST",
    sourceUserEmail: PRIMARY_BRIAN_SANDBOX_CONTEXT.email,
    scenarioId: null,
    scenarioNameHint: null,
    scenarioSelectionStrategy: "baseline",
    houseSelectionStrategy: "source_house_id",
    baselineType: "manual_annual",
    travelRanges: [...PRIMARY_INTERVAL_TRAVEL_RANGES],
    validationSelectionMode: "stratified_weather_balanced",
    validationDayCount: 14,
    validationOnlyDateKeysLocal: [],
    weatherPreference: "LAST_YEAR_WEATHER",
    persistRequested: true,
    expectedTruthSource: "effective_manual_stage_one_payload",
    expectations: {
      expectedBaselineParity: true,
      expectedPastSimCompareAvailable: false,
      expectedMonthlyCompareAvailable: false,
      expectedIntervalCompareAvailable: false,
      targetWapeMax: 20,
      targetMaeMax: 12,
      knownWeaknessNotes:
        "This phase-1 preset is the annual passthrough checkpoint. It should not fabricate a synthetic annual baseline when the saved annual payload is missing.",
    },
    notes:
      "Manual-annual phase-1 preset for the Brian sandbox house. Use it as the Stage 1 passthrough checkpoint before Past or Future simulation.",
  }),
  buildKnownScenario({
    scenarioKey: "keeper-manual-annual-past-primary",
    label: "Brian manual annual Past primary",
    active: true,
    mode: "MANUAL_ANNUAL",
    scenarioType: "MANUAL_ANNUAL_TEST",
    sourceUserEmail: PRIMARY_BRIAN_SANDBOX_CONTEXT.email,
    scenarioId: null,
    scenarioNameHint: "Past",
    scenarioSelectionStrategy: "scenario_name",
    houseSelectionStrategy: "source_house_id",
    baselineType: "manual_annual",
    travelRanges: [...PRIMARY_INTERVAL_TRAVEL_RANGES],
    validationSelectionMode: "stratified_weather_balanced",
    validationDayCount: 14,
    validationOnlyDateKeysLocal: [],
    weatherPreference: "LAST_YEAR_WEATHER",
    persistRequested: true,
    expectedTruthSource: "effective_manual_stage_one_payload",
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
  }),
  buildKnownScenario({
    scenarioKey: "keeper-manual-annual-future-primary",
    label: "Brian manual annual Future primary",
    active: true,
    mode: "MANUAL_ANNUAL",
    scenarioType: "MANUAL_ANNUAL_TEST",
    sourceUserEmail: PRIMARY_BRIAN_SANDBOX_CONTEXT.email,
    scenarioId: null,
    scenarioNameHint: "Future",
    scenarioSelectionStrategy: "scenario_name",
    houseSelectionStrategy: "source_house_id",
    baselineType: "manual_annual",
    travelRanges: [...PRIMARY_INTERVAL_TRAVEL_RANGES],
    validationSelectionMode: "stratified_weather_balanced",
    validationDayCount: 14,
    validationOnlyDateKeysLocal: [],
    weatherPreference: "LAST_YEAR_WEATHER",
    persistRequested: true,
    expectedTruthSource: "effective_manual_stage_one_payload",
    expectations: {
      expectedBaselineParity: false,
      expectedPastSimCompareAvailable: true,
      expectedMonthlyCompareAvailable: true,
      expectedIntervalCompareAvailable: true,
      targetWapeMax: 20,
      targetMaeMax: 12,
      knownWeaknessNotes:
        "Future manual-annual tuning should stay separate from the phase-1 checkpoint so annual stage-2 drift remains visible.",
    },
    notes:
      "Manual-annual Future preset for the Brian sandbox house. It keeps future sim runs distinct from both phase 1 passthrough and Past Sim tuning.",
  }),
  buildKnownScenario({
    scenarioKey: "keeper-new-build-past-primary",
    label: "Brian new build Past Sim primary",
    active: true,
    mode: "NEW_BUILD",
    scenarioType: "NEW_BUILD_TEST",
    sourceUserEmail: PRIMARY_BRIAN_SANDBOX_CONTEXT.email,
    scenarioId: null,
    scenarioNameHint: "Past",
    scenarioSelectionStrategy: "scenario_name",
    houseSelectionStrategy: "source_house_id",
    baselineType: "new_build",
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
      knownWeaknessNotes: "New build has no baseline preset. Past and Future are the only sim lifecycle checkpoints.",
    },
    notes:
      "Primary new-build Past preset for the Brian sandbox house. It intentionally skips baseline and starts at the simulated Past checkpoint.",
  }),
  buildKnownScenario({
    scenarioKey: "keeper-new-build-future-primary",
    label: "Brian new build Future Sim primary",
    active: true,
    mode: "NEW_BUILD",
    scenarioType: "NEW_BUILD_TEST",
    sourceUserEmail: PRIMARY_BRIAN_SANDBOX_CONTEXT.email,
    scenarioId: null,
    scenarioNameHint: "Future",
    scenarioSelectionStrategy: "scenario_name",
    houseSelectionStrategy: "source_house_id",
    baselineType: "new_build",
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
      knownWeaknessNotes: "New build has no passthrough baseline; Future stays a separate sim checkpoint from new-build Past.",
    },
    notes:
      "Primary new-build Future preset for the Brian sandbox house. It intentionally skips baseline and keeps Future separate from Past.",
  }),
  buildKnownScenario({
    scenarioKey: "keeper-green-button-baseline-primary",
    label: "Brian green button baseline primary",
    active: true,
    mode: "INTERVAL",
    scenarioType: "GREEN_BUTTON_TRUTH",
    sourceUserEmail: PRIMARY_BRIAN_SANDBOX_CONTEXT.email,
    scenarioId: null,
    scenarioNameHint: null,
    scenarioSelectionStrategy: "baseline",
    houseSelectionStrategy: "source_house_id",
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
      expectedIntervalCompareAvailable: false,
      knownWeaknessNotes:
        "Green Button baseline is still usage passthrough only. Keep it separate from interval SMT presets so source-family checks stay explicit.",
    },
    notes:
      "Green Button baseline preset family. Baseline remains passthrough only and should be used when the keeper context resolves Green Button-backed actual usage truth.",
  }),
  buildKnownScenario({
    scenarioKey: "keeper-green-button-past-primary",
    label: "Brian green button Past Sim primary",
    active: true,
    mode: "INTERVAL",
    scenarioType: "GREEN_BUTTON_TRUTH",
    sourceUserEmail: PRIMARY_BRIAN_SANDBOX_CONTEXT.email,
    scenarioId: null,
    scenarioNameHint: "Past",
    scenarioSelectionStrategy: "scenario_name",
    houseSelectionStrategy: "source_house_id",
    baselineType: "green_button_truth",
    travelRanges: [],
    validationSelectionMode: "stratified_weather_balanced",
    validationDayCount: 14,
    validationOnlyDateKeysLocal: [],
    weatherPreference: "LAST_YEAR_WEATHER",
    persistRequested: true,
    expectedTruthSource: "green_button_usage_output",
    expectations: {
      expectedBaselineParity: false,
      expectedPastSimCompareAvailable: true,
      expectedMonthlyCompareAvailable: true,
      expectedIntervalCompareAvailable: true,
      targetWapeMax: 15,
      targetMaeMax: 10,
      targetRmseMax: 15,
      knownWeaknessNotes:
        "Green Button Past should remain separate from baseline passthrough so simulated drift is measured against interval-backed Green Button truth.",
    },
    notes:
      "Green Button Past preset family. Use it when the keeper context resolves Green Button-backed interval truth and you want Past compare/checkpoint coverage.",
  }),
  buildKnownScenario({
    scenarioKey: "keeper-green-button-future-primary",
    label: "Brian green button Future Sim primary",
    active: true,
    mode: "INTERVAL",
    scenarioType: "GREEN_BUTTON_TRUTH",
    sourceUserEmail: PRIMARY_BRIAN_SANDBOX_CONTEXT.email,
    scenarioId: null,
    scenarioNameHint: "Future",
    scenarioSelectionStrategy: "scenario_name",
    houseSelectionStrategy: "source_house_id",
    baselineType: "green_button_truth",
    travelRanges: [],
    validationSelectionMode: "stratified_weather_balanced",
    validationDayCount: 14,
    validationOnlyDateKeysLocal: [],
    weatherPreference: "LAST_YEAR_WEATHER",
    persistRequested: true,
    expectedTruthSource: "green_button_usage_output",
    expectations: {
      expectedBaselineParity: false,
      expectedPastSimCompareAvailable: true,
      expectedMonthlyCompareAvailable: true,
      expectedIntervalCompareAvailable: true,
      targetWapeMax: 15,
      targetMaeMax: 10,
      targetRmseMax: 15,
      knownWeaknessNotes:
        "Green Button Future should remain a separate sim checkpoint from both Green Button baseline passthrough and Green Button Past.",
    },
    notes:
      "Green Button Future preset family. Use it when the keeper context resolves Green Button-backed interval truth and you want Future checkpoint coverage.",
  }),
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
