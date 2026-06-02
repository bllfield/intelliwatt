/**
 * Single owner for Past simulated artifact cache identity (houseId + scenarioId + inputHash).
 * All persist and read paths must use resolvePastArtifactIdentity — no parallel hash recipes.
 */

import { getIntervalDataFingerprint } from "@/lib/usage/actualDatasetForHouse";
import { preferredActualSourceFromPastBuildInputs } from "@/lib/usage/pastSimValidationReadBackfill";
import {
  computePastInputHash,
  PAST_ENGINE_VERSION,
  type PastInputHashPayload,
} from "@/modules/usageSimulator/pastCache";
import { resolveWeatherLogicModeFromBuildInputs } from "@/modules/usageSimulator/pastSimWeatherPolicy";
import { getHouseAddressForUserHouse } from "@/modules/usageSimulator/repo";
import { resolveWindowFromBuildInputsForPastIdentity } from "@/modules/usageSimulator/windowIdentity";
import { getUsageShapeProfileIdentityForPast } from "@/modules/simulatedUsage/simulatePastUsageDataset";
import { computePastWeatherIdentity } from "@/modules/weather/identity";

export type PastArtifactTravelRange = { startDate: string; endDate: string };

export type ResolvedPastArtifactIdentity = {
  engineVersion: string;
  inputHash: string;
  window: { startDate: string; endDate: string };
  timezone: string;
  travelRanges: PastArtifactTravelRange[];
  preferredSource: "SMT" | "GREEN_BUTTON" | null;
  intervalDataFingerprint: string;
  weatherIdentity: string | null;
  usageShapeProfileId: string | null;
  usageShapeProfileVersion: string | null;
  usageShapeProfileDerivedAt: string | null;
  usageShapeProfileSimHash: string | null;
  canonicalActualHouseId: string;
  canonicalActualEsiid: string | null;
};

export function travelRangesFromPastBuildInputs(
  buildInputs: Record<string, unknown> | null | undefined
): PastArtifactTravelRange[] {
  const b = buildInputs ?? {};
  if (!Array.isArray((b as { travelRanges?: unknown }).travelRanges)) return [];
  const uniq = new Map<string, PastArtifactTravelRange>();
  for (const row of (b as { travelRanges: unknown[] }).travelRanges) {
    const startDate = String((row as { startDate?: unknown })?.startDate ?? "").slice(0, 10);
    const endDate = String((row as { endDate?: unknown })?.endDate ?? "").slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate) || !/^\d{4}-\d{2}-\d{2}$/.test(endDate)) continue;
    uniq.set(`${startDate}__${endDate}`, { startDate, endDate });
  }
  return Array.from(uniq.values()).sort((a, b) => {
    const left = `${a.startDate}__${a.endDate}`;
    const right = `${b.startDate}__${b.endDate}`;
    return left < right ? -1 : left > right ? 1 : 0;
  });
}

async function resolveCanonicalActualIdentityForPastArtifact(args: {
  userId: string;
  requestHouseId: string;
  requestHouseEsiid: string | null;
  buildInputs: Record<string, unknown>;
}): Promise<{ houseId: string; esiid: string | null }> {
  const buildActualContextHouseId =
    typeof args.buildInputs.actualContextHouseId === "string" &&
    String(args.buildInputs.actualContextHouseId).trim()
      ? String(args.buildInputs.actualContextHouseId).trim()
      : args.requestHouseId;
  if (buildActualContextHouseId === args.requestHouseId) {
    return { houseId: args.requestHouseId, esiid: args.requestHouseEsiid ?? null };
  }
  const actualHouse = await getHouseAddressForUserHouse({
    userId: args.userId,
    houseId: buildActualContextHouseId,
  });
  return {
    houseId: buildActualContextHouseId,
    esiid:
      actualHouse && typeof actualHouse.esiid === "string" && String(actualHouse.esiid).trim()
        ? String(actualHouse.esiid)
        : args.requestHouseEsiid ?? null,
  };
}

function isLeanManualTotalsModeFromBuildInputs(buildInputs: Record<string, unknown>): boolean {
  const mode = String(buildInputs.mode ?? "");
  return mode === "MANUAL_TOTALS";
}

export async function resolvePastArtifactIdentity(args: {
  userId: string;
  requestHouseId: string;
  requestHouseEsiid: string | null;
  buildInputs: Record<string, unknown>;
}): Promise<ResolvedPastArtifactIdentity | null> {
  const window = resolveWindowFromBuildInputsForPastIdentity(args.buildInputs);
  if (!window) return null;

  const timezone = String(args.buildInputs.timezone ?? "America/Chicago");
  const travelRanges = travelRangesFromPastBuildInputs(args.buildInputs);
  const preferredSource = preferredActualSourceFromPastBuildInputs(args.buildInputs);
  const canonicalActual = await resolveCanonicalActualIdentityForPastArtifact({
    userId: args.userId,
    requestHouseId: args.requestHouseId,
    requestHouseEsiid: args.requestHouseEsiid,
    buildInputs: args.buildInputs,
  });

  const intervalDataFingerprint = await getIntervalDataFingerprint({
    houseId: canonicalActual.houseId,
    esiid: canonicalActual.esiid,
    startDate: window.startDate,
    endDate: window.endDate,
    preferredSource,
  });

  const usageShapeProfileIdentity = isLeanManualTotalsModeFromBuildInputs(args.buildInputs)
    ? {
        usageShapeProfileId: null,
        usageShapeProfileVersion: null,
        usageShapeProfileDerivedAt: null,
        usageShapeProfileSimHash: null,
      }
    : await getUsageShapeProfileIdentityForPast(args.requestHouseId);

  const weatherHouseId = String(args.buildInputs.actualContextHouseId ?? args.requestHouseId);
  const weatherIdentity = await computePastWeatherIdentity({
    houseId: weatherHouseId,
    startDate: window.startDate,
    endDate: window.endDate,
    weatherLogicMode: resolveWeatherLogicModeFromBuildInputs(args.buildInputs),
  });

  const hashPayload: PastInputHashPayload = {
    engineVersion: PAST_ENGINE_VERSION,
    windowStartUtc: window.startDate,
    windowEndUtc: window.endDate,
    timezone,
    travelRanges,
    buildInputs: args.buildInputs,
    intervalDataFingerprint,
    usageShapeProfileId: usageShapeProfileIdentity.usageShapeProfileId,
    usageShapeProfileVersion: usageShapeProfileIdentity.usageShapeProfileVersion,
    usageShapeProfileDerivedAt: usageShapeProfileIdentity.usageShapeProfileDerivedAt,
    usageShapeProfileSimHash: usageShapeProfileIdentity.usageShapeProfileSimHash,
    weatherIdentity,
  };

  return {
    engineVersion: PAST_ENGINE_VERSION,
    inputHash: computePastInputHash(hashPayload),
    window,
    timezone,
    travelRanges,
    preferredSource,
    intervalDataFingerprint,
    weatherIdentity,
    usageShapeProfileId: usageShapeProfileIdentity.usageShapeProfileId,
    usageShapeProfileVersion: usageShapeProfileIdentity.usageShapeProfileVersion,
    usageShapeProfileDerivedAt: usageShapeProfileIdentity.usageShapeProfileDerivedAt,
    usageShapeProfileSimHash: usageShapeProfileIdentity.usageShapeProfileSimHash,
    canonicalActualHouseId: canonicalActual.houseId,
    canonicalActualEsiid: canonicalActual.esiid,
  };
}
