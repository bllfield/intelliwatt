/**
 * Single shared WholeHomeFingerprint builder (Phase 2b). Same entrypoint for recalc and future prebuild.
 */

import type { Prisma } from "@/.prisma/usage-client";
import { SimulatorFingerprintStatus } from "@/.prisma/usage-client";
import {
  getLatestWholeHomeFingerprintByHouseId,
  upsertWholeHomeFingerprintArtifact,
} from "@/modules/usageSimulator/fingerprintArtifactsRepo";
import { sha256HexUtf8, stableStringify } from "@/modules/usageSimulator/fingerprintHash";

export const WHOLE_HOME_FINGERPRINT_ALGORITHM_VERSION = "whole_home_fp_v1";

/** Audited home + appliance fields aligned to UNIFIED_SIM_FINGERPRINT_PLAN Section 17 (subset for hashing). */
export function pickWholeHomeFingerprintInputs(args: {
  homeProfile: Record<string, unknown> | null | undefined;
  applianceProfile: Record<string, unknown> | null | undefined;
}): Record<string, unknown> {
  const h = args.homeProfile ?? {};
  const a = args.applianceProfile ?? {};
  return {
    squareFeet: h.squareFeet,
    stories: h.stories,
    insulationType: h.insulationType,
    windowType: h.windowType,
    foundation: h.foundation,
    occupantsWork: h.occupantsWork,
    occupantsSchool: h.occupantsSchool,
    occupantsHomeAllDay: h.occupantsHomeAllDay,
    summerTemp: h.summerTemp,
    winterTemp: h.winterTemp,
    fuelConfiguration: h.fuelConfiguration,
    hvacType: h.hvacType,
    heatingType: h.heatingType,
    hasPool: h.hasPool,
    poolPumpType: h.poolPumpType,
    poolPumpHp: h.poolPumpHp,
    poolSummerRunHoursPerDay: h.poolSummerRunHoursPerDay,
    poolWinterRunHoursPerDay: h.poolWinterRunHoursPerDay,
    hasPoolHeater: h.hasPoolHeater,
    poolHeaterType: h.poolHeaterType,
    evHasVehicle: h.evHasVehicle,
    evCount: h.evCount,
    evChargerType: h.evChargerType,
    evAvgMilesPerDay: h.evAvgMilesPerDay,
    evAvgKwhPerDay: h.evAvgKwhPerDay,
    evChargingBehavior: h.evChargingBehavior,
    evPreferredStartHr: h.evPreferredStartHr,
    evPreferredEndHr: h.evPreferredEndHr,
    evSmartCharger: h.evSmartCharger,
    applianceFuelConfiguration: a.fuelConfiguration,
    appliances: a.appliances,
  };
}

export function computeWholeHomeSourceHashFromInputs(inputs: Record<string, unknown>): string {
  return sha256HexUtf8(
    stableStringify({
      algorithmVersion: WHOLE_HOME_FINGERPRINT_ALGORITHM_VERSION,
      inputs,
    })
  );
}

export async function buildAndPersistWholeHomeFingerprint(args: {
  houseId: string;
  homeProfile: Record<string, unknown> | null | undefined;
  applianceProfile: Record<string, unknown> | null | undefined;
}): Promise<{ ok: true; sourceHash: string } | { ok: false; error: string }> {
  const { houseId, homeProfile, applianceProfile } = args;
  const prior = await getLatestWholeHomeFingerprintByHouseId(houseId).catch(() => null);
  const pendingHash = prior?.sourceHash ?? "pending";

  try {
    await upsertWholeHomeFingerprintArtifact({
      houseId,
      status: SimulatorFingerprintStatus.building,
      algorithmVersion: WHOLE_HOME_FINGERPRINT_ALGORITHM_VERSION,
      sourceHash: pendingHash,
      staleReason: null,
      builtAt: null,
      payloadJson: { phase: "building", priorStatus: prior?.status ?? null },
    });

    const picked = pickWholeHomeFingerprintInputs({ homeProfile, applianceProfile });
    const sourceHash = computeWholeHomeSourceHashFromInputs(picked);
    const payloadJson = {
      version: WHOLE_HOME_FINGERPRINT_ALGORITHM_VERSION,
      features: JSON.parse(JSON.stringify(picked)) as Prisma.InputJsonValue,
      cohort: { placeholder: true },
    } satisfies Prisma.InputJsonValue;

    await upsertWholeHomeFingerprintArtifact({
      houseId,
      status: SimulatorFingerprintStatus.ready,
      algorithmVersion: WHOLE_HOME_FINGERPRINT_ALGORITHM_VERSION,
      sourceHash,
      staleReason: null,
      builtAt: new Date(),
      payloadJson,
    });
    return { ok: true, sourceHash };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    await upsertWholeHomeFingerprintArtifact({
      houseId,
      status: SimulatorFingerprintStatus.failed,
      algorithmVersion: WHOLE_HOME_FINGERPRINT_ALGORITHM_VERSION,
      sourceHash: pendingHash === "pending" ? sha256HexUtf8(`failed:${houseId}:${Date.now()}`) : pendingHash,
      staleReason: msg,
      builtAt: null,
      payloadJson: { error: msg, phase: "failed" },
    }).catch(() => {});
    return { ok: false, error: msg };
  }
}
