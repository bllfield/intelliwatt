import {
  getKnownHouseScenarioByKey,
  resolveKnownHouseScenarioSelection,
  type OnePathKnownScenario,
} from "@/modules/onePathSim/knownHouseScenarios";

export type KnownScenarioHarnessRunControls = {
  mode: OnePathKnownScenario["mode"];
  weatherPreference: OnePathKnownScenario["weatherPreference"];
  validationSelectionMode: string;
  validationDayCount: number | null;
  validationOnlyDateKeysLocal: string[];
  validationOnlyDateKeysText: string;
  persistRequested: boolean;
  runReason: string;
  selectedScenarioId: string;
  selectedHouseId: string;
  actualContextHouseId: string;
  travelRanges: Array<{ startDate: string; endDate: string }>;
};

export function resolveTravelRangesForKnownScenario(args: {
  scenario: Pick<OnePathKnownScenario, "travelRanges">;
  travelRangesFromDb?: Array<{ startDate: string; endDate: string }>;
}): Array<{ startDate: string; endDate: string }> {
  if (args.scenario.travelRanges.length > 0) return args.scenario.travelRanges;
  return Array.isArray(args.travelRangesFromDb) ? args.travelRangesFromDb : [];
}

export function readTravelRangesFromLookupSourceContext(
  sourceContext: Record<string, unknown> | null | undefined
): Array<{ startDate: string; endDate: string }> {
  if (!sourceContext || !Array.isArray(sourceContext.travelRangesFromDb)) return [];
  return sourceContext.travelRangesFromDb as Array<{ startDate: string; endDate: string }>;
}

export function buildKnownScenarioHarnessRunControls(args: {
  scenario: OnePathKnownScenario;
  lookup: Parameters<typeof resolveKnownHouseScenarioSelection>[0]["lookup"];
  travelRangesFromDb?: Array<{ startDate: string; endDate: string }>;
}): KnownScenarioHarnessRunControls {
  const selection = resolveKnownHouseScenarioSelection({
    scenario: args.scenario,
    lookup: args.lookup,
  });
  const validationOnlyDateKeysLocal = [...args.scenario.validationOnlyDateKeysLocal];
  return {
    mode: args.scenario.mode,
    weatherPreference: args.scenario.weatherPreference,
    validationSelectionMode: args.scenario.validationSelectionMode ?? "stratified_weather_balanced",
    validationDayCount: args.scenario.validationDayCount,
    validationOnlyDateKeysLocal,
    validationOnlyDateKeysText: validationOnlyDateKeysLocal.join("\n"),
    persistRequested: args.scenario.persistRequested,
    runReason: `known_house:${args.scenario.scenarioKey}`,
    selectedScenarioId: selection.selectedScenarioId,
    selectedHouseId: selection.selectedHouseId,
    actualContextHouseId: selection.actualContextHouseId,
    travelRanges: resolveTravelRangesForKnownScenario({
      scenario: args.scenario,
      travelRangesFromDb: args.travelRangesFromDb,
    }),
  };
}

export function resolveKnownScenarioHarnessRunControls(args: {
  scenarioKey: string | null | undefined;
  lookup: Parameters<typeof resolveKnownHouseScenarioSelection>[0]["lookup"] | null | undefined;
  travelRangesFromDb?: Array<{ startDate: string; endDate: string }>;
}): KnownScenarioHarnessRunControls | null {
  const scenario = getKnownHouseScenarioByKey(args.scenarioKey);
  if (!scenario || !args.lookup) return null;
  return buildKnownScenarioHarnessRunControls({
    scenario,
    lookup: args.lookup,
    travelRangesFromDb: args.travelRangesFromDb,
  });
}
