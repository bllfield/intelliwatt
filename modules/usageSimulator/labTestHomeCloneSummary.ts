import { getApplianceProfileSimulatedByUserHouse } from "@/modules/applianceProfile/repo";
import { normalizeStoredApplianceProfile, validateApplianceProfile } from "@/modules/applianceProfile/validation";
import { getHomeProfileSimulatedByUserHouse } from "@/modules/homeProfile/repo";
import { validateHomeProfile } from "@/modules/homeProfile/validation";
import type { CoverageWindow } from "@/lib/usage/canonicalMetadataWindow";
import {
  filterTravelRangesToCoverageWindow,
  readTravelRangesForHouse,
  summarizeTravelRangesForCoverageWindow,
  type PastSimTravelRange,
} from "@/lib/usage/pastSimTravelRanges";

export type LabTestHomeCloneSummary = {
  copiedHomeProfile: boolean;
  copiedAppliances: boolean;
  /** Stored/history-preserved count copied to lab (includes archived historical rows). */
  copiedTravelRangesStoredCount: number;
  copiedVacantRangesStoredCount: number;
  /** @deprecated Use copiedTravelRangesStoredCount — raw stored count, not active operational count. */
  copiedTravelRanges: number;
  /** @deprecated Use copiedVacantRangesStoredCount — raw stored count, not active operational count. */
  copiedVacantRanges: number;
  copiedThermostatSettings: boolean;
  copiedHvacs: number;
  copiedWaterHeaters: number;
  copiedPools: number;
  copiedEvs: number;
  copiedSolarBatteryConfig: boolean;
  copiedActualUsage: false;
  copiedSourceIntervals: false;
  copiedSourceDailyRows: false;
  labHasRequiredHomeDetails: boolean;
  labHasRequiredAppliances: boolean;
  missingRequiredProfileFields: string[];
  missingRequiredApplianceFields: string[];
  /** @deprecated Use sourceTravelRangeStoredCount */
  sourceTravelRangeCount: number;
  /** @deprecated Use labTravelRangeStoredCount */
  labTravelRangeCount: number;
  travelRangesPersistedToLab: boolean;
  sourceTravelRangeStoredCount: number;
  sourceTravelRangeActiveCurrentWindowCount: number;
  sourceTravelRangeArchivedHistoricalCount: number;
  sourceTravelRangeFutureOutsideWindowCount: number;
  labTravelRangeStoredCount: number;
  labTravelRangeActiveCurrentWindowCount: number;
  labTravelRangeArchivedHistoricalCount: number;
  labTravelRangeFutureOutsideWindowCount: number;
  copiedActiveTravelRanges: number;
  copiedArchivedHistoricalRangesAsActive: boolean;
  effectiveTravelRangesForRecalc: PastSimTravelRange[];
};

function countAppliancesByType(appliances: Array<{ type?: unknown }>, ...types: string[]): number {
  const normalized = new Set(types.map((t) => t.toLowerCase()));
  return appliances.filter((row) => normalized.has(String(row?.type ?? "").trim().toLowerCase())).length;
}

function profileFeatureCounts(homeProfile: Awaited<ReturnType<typeof getHomeProfileSimulatedByUserHouse>>): {
  copiedThermostatSettings: boolean;
  copiedHvacs: number;
  copiedPools: number;
  copiedEvs: number;
  copiedSolarBatteryConfig: boolean;
} {
  if (!homeProfile) {
    return {
      copiedThermostatSettings: false,
      copiedHvacs: 0,
      copiedPools: 0,
      copiedEvs: 0,
      copiedSolarBatteryConfig: false,
    };
  }
  const hvacConfigured = Boolean(homeProfile.hvacType && homeProfile.heatingType);
  const poolCount = homeProfile.hasPool ? 1 : 0;
  const evCount = homeProfile.ev?.hasVehicle || (homeProfile as { evHasVehicle?: boolean }).evHasVehicle ? 1 : 0;
  return {
    copiedThermostatSettings: Boolean(homeProfile.smartThermostat),
    copiedHvacs: hvacConfigured ? 1 : 0,
    copiedPools: poolCount,
    copiedEvs: evCount,
    copiedSolarBatteryConfig: false,
  };
}

function collectMissingProfileFields(
  homeProfile: Awaited<ReturnType<typeof getHomeProfileSimulatedByUserHouse>>
): string[] {
  if (!homeProfile) return ["homeProfile_missing"];
  const validated = validateHomeProfile(homeProfile, { requirePastBaselineFields: true });
  if (validated.ok) return [];
  return [validated.error];
}

function collectMissingApplianceFields(
  applianceProfile: Awaited<ReturnType<typeof getApplianceProfileSimulatedByUserHouse>>
): string[] {
  if (!applianceProfile?.appliancesJson) return ["applianceProfile_missing"];
  const validated = validateApplianceProfile(normalizeStoredApplianceProfile(applianceProfile.appliancesJson));
  if (validated.ok) return [];
  return [validated.error];
}

export async function buildLabTestHomeCloneSummary(args: {
  ownerUserId: string;
  labHouseId: string;
  sourceUserId: string;
  sourceHouseId: string;
  sourceTravelRanges: ReadonlyArray<PastSimTravelRange>;
  labTravelRanges: ReadonlyArray<PastSimTravelRange>;
  copiedHomeProfile: boolean;
  copiedAppliances: boolean;
  coverageWindow?: CoverageWindow | null;
}): Promise<LabTestHomeCloneSummary> {
  const [labHomeProfile, labApplianceProfile] = await Promise.all([
    getHomeProfileSimulatedByUserHouse({ userId: args.ownerUserId, houseId: args.labHouseId }),
    getApplianceProfileSimulatedByUserHouse({ userId: args.ownerUserId, houseId: args.labHouseId }),
  ]);

  const applianceRows = normalizeStoredApplianceProfile(labApplianceProfile?.appliancesJson ?? null).appliances;
  const featureCounts = profileFeatureCounts(labHomeProfile);
  const waterHeaterCount = countAppliancesByType(applianceRows, "water_heater", "water heater", "water-heater");
  const solarBatteryCount = countAppliancesByType(
    applianceRows,
    "solar",
    "battery",
    "solar_battery",
    "solar+battery",
    "solar_and_battery"
  );

  const missingRequiredProfileFields = collectMissingProfileFields(labHomeProfile);
  const missingRequiredApplianceFields = collectMissingApplianceFields(labApplianceProfile);
  const sourceSummary = summarizeTravelRangesForCoverageWindow(args.sourceTravelRanges, args.coverageWindow);
  const labSummary = summarizeTravelRangesForCoverageWindow(args.labTravelRanges, args.coverageWindow);
  const effectiveTravelRangesForRecalc = filterTravelRangesToCoverageWindow(
    args.labTravelRanges.length > 0 ? args.labTravelRanges : args.sourceTravelRanges,
    args.coverageWindow
  );
  const copiedActiveTravelRanges = labSummary.activeCurrentWindowCount;
  const copiedArchivedHistoricalRangesAsActive = labSummary.classifications.some(
    (row) => row.archivedHistorical && row.activeForCurrentWindow
  );

  return {
    copiedHomeProfile: args.copiedHomeProfile,
    copiedAppliances: args.copiedAppliances,
    copiedTravelRangesStoredCount: args.sourceTravelRanges.length,
    copiedVacantRangesStoredCount: args.sourceTravelRanges.length,
    copiedTravelRanges: args.sourceTravelRanges.length,
    copiedVacantRanges: args.sourceTravelRanges.length,
    copiedThermostatSettings: featureCounts.copiedThermostatSettings,
    copiedHvacs: featureCounts.copiedHvacs,
    copiedWaterHeaters: waterHeaterCount,
    copiedPools: featureCounts.copiedPools,
    copiedEvs: featureCounts.copiedEvs,
    copiedSolarBatteryConfig: solarBatteryCount > 0,
    copiedActualUsage: false,
    copiedSourceIntervals: false,
    copiedSourceDailyRows: false,
    labHasRequiredHomeDetails: missingRequiredProfileFields.length === 0,
    labHasRequiredAppliances: missingRequiredApplianceFields.length === 0,
    missingRequiredProfileFields,
    missingRequiredApplianceFields,
    sourceTravelRangeCount: args.sourceTravelRanges.length,
    labTravelRangeCount: args.labTravelRanges.length,
    travelRangesPersistedToLab:
      args.sourceTravelRanges.length === 0 ? true : args.labTravelRanges.length >= args.sourceTravelRanges.length,
    sourceTravelRangeStoredCount: sourceSummary.storedCount,
    sourceTravelRangeActiveCurrentWindowCount: sourceSummary.activeCurrentWindowCount,
    sourceTravelRangeArchivedHistoricalCount: sourceSummary.archivedHistoricalCount,
    sourceTravelRangeFutureOutsideWindowCount: sourceSummary.futureOutsideCurrentWindowCount,
    labTravelRangeStoredCount: labSummary.storedCount,
    labTravelRangeActiveCurrentWindowCount: labSummary.activeCurrentWindowCount,
    labTravelRangeArchivedHistoricalCount: labSummary.archivedHistoricalCount,
    labTravelRangeFutureOutsideWindowCount: labSummary.futureOutsideCurrentWindowCount,
    copiedActiveTravelRanges,
    copiedArchivedHistoricalRangesAsActive,
    effectiveTravelRangesForRecalc,
  };
}

export async function readLabAndSourceTravelRanges(args: {
  ownerUserId: string;
  labHouseId: string;
  sourceUserId: string;
  sourceHouseId: string;
}): Promise<{ sourceTravelRanges: PastSimTravelRange[]; labTravelRanges: PastSimTravelRange[] }> {
  const [sourceTravelRanges, labTravelRanges] = await Promise.all([
    readTravelRangesForHouse({ userId: args.sourceUserId, houseId: args.sourceHouseId }),
    readTravelRangesForHouse({ userId: args.ownerUserId, houseId: args.labHouseId }),
  ]);
  return { sourceTravelRanges, labTravelRanges };
}
