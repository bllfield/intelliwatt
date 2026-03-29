/**
 * Shared orchestration: same `ensureSimulatorFingerprintsForRecalc` entrypoint for inline recalc
 * and future background/prebuild callers (Phase 2b / Section 11).
 */

import type { SimulatorMode } from "@/modules/usageSimulator/requirements";
import { buildAndPersistUsageFingerprint } from "@/modules/usageSimulator/usageFingerprintBuilder";
import { buildAndPersistWholeHomeFingerprint } from "@/modules/usageSimulator/wholeHomeFingerprintBuilder";

export type EnsureSimulatorFingerprintsArgs = {
  houseId: string;
  actualContextHouseId: string;
  esiid: string | null;
  homeProfile: Record<string, unknown> | null | undefined;
  applianceProfile: Record<string, unknown> | null | undefined;
  mode: SimulatorMode;
  /** From recalc ladder: actual 15m intervals available for SMT_BASELINE. */
  actualOk: boolean;
  windowStart: string;
  windowEnd: string;
  correlationId?: string;
};

/**
 * Ensures WholeHome fingerprint is refreshed; Usage fingerprint when SMT_BASELINE + actual data.
 * Callers: `recalcSimulatorBuild` (inline) and future prebuild jobs (same function).
 */
export async function ensureSimulatorFingerprintsForRecalc(args: EnsureSimulatorFingerprintsArgs): Promise<void> {
  await buildAndPersistWholeHomeFingerprint({
    houseId: args.houseId,
    homeProfile: args.homeProfile,
    applianceProfile: args.applianceProfile,
  });

  if (args.mode === "SMT_BASELINE" && args.actualOk) {
    await buildAndPersistUsageFingerprint({
      houseId: args.actualContextHouseId,
      esiid: args.esiid,
      startDate: args.windowStart,
      endDate: args.windowEnd,
      correlationId: args.correlationId,
    });
  }
}

/** Explicit alias for background/prebuild orchestration (same implementation as recalc). */
export const prebuildSimulatorFingerprints = ensureSimulatorFingerprintsForRecalc;
