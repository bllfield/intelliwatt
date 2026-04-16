/**
 * Backward-compatible wrapper around the shared manual Stage 1 helper family.
 * GapFill and Manual Usage Lab should now use the same manual pre-lockbox helper ownership.
 */

import { getActualUsageDatasetForHouse } from "@/lib/usage/actualDatasetForHouse";
import type { ManualUsagePayload } from "@/modules/onePathSim/simulatedUsage/types";
import type { AdminLabTreatmentMode } from "@/modules/onePathSim/usageSimulator/adminLabTreatment";
import {
  buildManualUsageStageOneResolvedSeeds,
  resolveManualUsageStageOnePayloadForMode,
} from "@/modules/onePathSim/manualPrefill";
import type { SourceDerivedMonthlyTargetResolution } from "@/modules/onePathSim/usageSimulator/monthlyTargetConstruction";

export async function buildAdminLabSyntheticManualUsagePayload(args: {
  treatmentMode: Extract<AdminLabTreatmentMode, "manual_monthly_constrained" | "manual_annual_constrained">;
  canonicalMonths: string[];
  actualContextHouseId: string;
  esiid: string | null;
  monthlyAnchorEndDate?: string | null;
  homeProfile: unknown;
  applianceProfile: unknown;
  travelRanges?: Array<{ startDate: string; endDate: string }>;
  sourcePayload?: ManualUsagePayload | null;
  testHomePayload?: ManualUsagePayload | null;
}): Promise<{
  payload: ManualUsagePayload;
  monthlySourceDerivedResolution: SourceDerivedMonthlyTargetResolution | null;
}> {
  const actualUsage = await getActualUsageDatasetForHouse(args.actualContextHouseId, args.esiid ?? null, {
    skipFullYearIntervalFetch: true,
  }).catch(() => ({ dataset: null }));
  const seedSet = buildManualUsageStageOneResolvedSeeds({
    sourcePayload: args.sourcePayload ?? null,
    actualEndDate:
      String(
        actualUsage?.dataset?.summary?.end ??
          args.monthlyAnchorEndDate ??
          ""
      ).slice(0, 10) || null,
    travelRanges: args.travelRanges ?? [],
    dailyRows: actualUsage?.dataset?.daily ?? [],
  });
  const resolved = resolveManualUsageStageOnePayloadForMode({
    mode: args.treatmentMode === "manual_annual_constrained" ? "ANNUAL" : "MONTHLY",
    testHomePayload: args.testHomePayload ?? null,
    seedSet,
  });
  if (!resolved.payload) {
    throw new Error("shared_manual_stage_one_payload_unresolved");
  }
  return {
    payload: resolved.payload,
    monthlySourceDerivedResolution: null,
  };
}

