/**
 * Single shared UsageFingerprint builder (Phase 2b). Same entrypoint for recalc and future prebuild.
 */

import { SimulatorFingerprintStatus } from "@/.prisma/usage-client";
import { getIntervalDataFingerprint } from "@/lib/usage/actualDatasetForHouse";
import {
  getLatestUsageFingerprintByHouseId,
  upsertUsageFingerprintArtifact,
} from "@/modules/onePathSim/usageSimulator/fingerprintArtifactsRepo";
import { sha256HexUtf8, stableStringify } from "@/modules/onePathSim/usageSimulator/fingerprintHash";
import { computePastWeatherIdentity } from "@/modules/weather/identity";
import {
  FINGERPRINT_PIPELINE_EVENT,
  getMemoryRssMb,
  logSimPipelineEvent,
} from "@/modules/onePathSim/usageSimulator/simObservability";

export const USAGE_FINGERPRINT_ALGORITHM_VERSION = "usage_fp_v1";

export type PreparedUsageFingerprintBuild = {
  intervalDataFingerprint: string;
  weatherIdentity: string;
  sourceHash: string;
  payloadJson: {
    version: string;
    window: { startDate: string; endDate: string };
    intervalDataFingerprint: string;
    weatherIdentity: string;
    summary: { note: string };
  };
};

export function computeUsageFingerprintSourceHash(args: {
  intervalDataFingerprint: string;
  weatherIdentity: string;
  windowStart: string;
  windowEnd: string;
}): string {
  return sha256HexUtf8(
    stableStringify({
      algorithmVersion: USAGE_FINGERPRINT_ALGORITHM_VERSION,
      intervalDataFingerprint: args.intervalDataFingerprint,
      weatherIdentity: args.weatherIdentity,
      windowStart: args.windowStart,
      windowEnd: args.windowEnd,
    })
  );
}

export async function prepareUsageFingerprintBuild(args: {
  houseId: string;
  esiid: string | null;
  startDate: string;
  endDate: string;
}): Promise<PreparedUsageFingerprintBuild> {
  const { houseId, esiid, startDate, endDate } = args;
  const [intervalDataFingerprint, weatherIdentity] = await Promise.all([
    getIntervalDataFingerprint({ houseId, esiid, startDate, endDate }),
    computePastWeatherIdentity({ houseId, startDate, endDate }),
  ]);
  const sourceHash = computeUsageFingerprintSourceHash({
    intervalDataFingerprint,
    weatherIdentity,
    windowStart: startDate,
    windowEnd: endDate,
  });
  const payloadJson = {
    version: USAGE_FINGERPRINT_ALGORITHM_VERSION,
    window: { startDate, endDate },
    intervalDataFingerprint,
    weatherIdentity,
    summary: { note: "usage_fp_v1 training summary placeholder" },
  };
  return { intervalDataFingerprint, weatherIdentity, sourceHash, payloadJson };
}

export async function buildAndPersistUsageFingerprint(args: {
  houseId: string;
  esiid: string | null;
  startDate: string;
  endDate: string;
  correlationId?: string;
  prepared?: PreparedUsageFingerprintBuild;
  priorArtifact?: { sourceHash?: string | null; status?: string | null } | null;
}): Promise<{ ok: true; sourceHash: string } | { ok: false; error: string }> {
  const { houseId, esiid, startDate, endDate, correlationId } = args;
  const startedAt = Date.now();
  logSimPipelineEvent(FINGERPRINT_PIPELINE_EVENT.usageFingerprintBuildStart, {
    correlationId,
    houseId,
    source: "buildAndPersistUsageFingerprint",
    memoryRssMb: getMemoryRssMb(),
  });
  const prior = args.priorArtifact ?? (await getLatestUsageFingerprintByHouseId(houseId).catch(() => null));
  const pendingHash = prior?.sourceHash ?? "pending";

  try {
    await upsertUsageFingerprintArtifact({
      houseId,
      status: SimulatorFingerprintStatus.building,
      algorithmVersion: USAGE_FINGERPRINT_ALGORITHM_VERSION,
      sourceHash: pendingHash,
      staleReason: null,
      builtAt: null,
      payloadJson: { phase: "building", correlationId: args.correlationId ?? null },
    });

    const prepared =
      args.prepared ??
      (await prepareUsageFingerprintBuild({
        houseId,
        esiid,
        startDate,
        endDate,
      }));
    const { intervalDataFingerprint, weatherIdentity, sourceHash, payloadJson } = prepared;

    if (!intervalDataFingerprint) {
      await upsertUsageFingerprintArtifact({
        houseId,
        status: SimulatorFingerprintStatus.failed,
        algorithmVersion: USAGE_FINGERPRINT_ALGORITHM_VERSION,
        sourceHash: pendingHash === "pending" ? sha256HexUtf8(`failed:${houseId}:usage`) : pendingHash,
        staleReason: "interval_fingerprint_unavailable",
        builtAt: null,
        payloadJson: { error: "interval_fingerprint_unavailable", window: { startDate, endDate } },
      });
      logSimPipelineEvent(FINGERPRINT_PIPELINE_EVENT.usageFingerprintBuildFailure, {
        correlationId,
        houseId,
        durationMs: Date.now() - startedAt,
        failureCode: "interval_fingerprint_unavailable",
        failureMessage: "interval_fingerprint_unavailable",
        memoryRssMb: getMemoryRssMb(),
        source: "buildAndPersistUsageFingerprint",
      });
      return { ok: false, error: "interval_fingerprint_unavailable" };
    }

    await upsertUsageFingerprintArtifact({
      houseId,
      status: SimulatorFingerprintStatus.ready,
      algorithmVersion: USAGE_FINGERPRINT_ALGORITHM_VERSION,
      sourceHash,
      staleReason: null,
      builtAt: new Date(),
      payloadJson,
    });
    logSimPipelineEvent(FINGERPRINT_PIPELINE_EVENT.usageFingerprintBuildSuccess, {
      correlationId,
      houseId,
      durationMs: Date.now() - startedAt,
      memoryRssMb: getMemoryRssMb(),
      source: "buildAndPersistUsageFingerprint",
    });
    return { ok: true, sourceHash };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    await upsertUsageFingerprintArtifact({
      houseId,
      status: SimulatorFingerprintStatus.failed,
      algorithmVersion: USAGE_FINGERPRINT_ALGORITHM_VERSION,
      sourceHash: pendingHash === "pending" ? sha256HexUtf8(`failed:${houseId}:${Date.now()}`) : pendingHash,
      staleReason: msg,
      builtAt: null,
      payloadJson: { error: msg, phase: "failed" },
    }).catch(() => {});
    logSimPipelineEvent(FINGERPRINT_PIPELINE_EVENT.usageFingerprintBuildFailure, {
      correlationId,
      houseId,
      durationMs: Date.now() - startedAt,
      failureMessage: msg,
      memoryRssMb: getMemoryRssMb(),
      source: "buildAndPersistUsageFingerprint",
    });
    return { ok: false, error: msg };
  }
}

