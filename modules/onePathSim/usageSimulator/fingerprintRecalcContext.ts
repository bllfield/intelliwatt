import type { SimulatorMode } from "@/modules/onePathSim/usageSimulator/requirements";
import { resolveSimFingerprint } from "@/modules/onePathSim/usageSimulator/resolveSimFingerprint";
import type { ResolvedSimFingerprint } from "@/modules/onePathSim/usageSimulator/resolvedSimFingerprintTypes";
import {
  evaluateUsageFingerprintPolicy,
  evaluateWholeHomeFingerprintPolicy,
  type FingerprintPolicyDecision,
} from "@/modules/onePathSim/usageSimulator/fingerprintArtifactPolicy";
import { getMemoryRssMb, logSimPipelineEvent } from "@/modules/onePathSim/usageSimulator/simObservability";

export type FingerprintRecalcContextArgs = {
  houseId: string;
  actualContextHouseId: string;
  esiid: string | null;
  homeProfile: Record<string, unknown> | null | undefined;
  applianceProfile: Record<string, unknown> | null | undefined;
  mode: SimulatorMode;
  actualOk: boolean;
  windowStart: string;
  windowEnd: string;
  correlationId?: string;
};

export type FingerprintRecalcContext = FingerprintRecalcContextArgs & {
  getWholeHomePolicy: () => Promise<
    Awaited<ReturnType<typeof evaluateWholeHomeFingerprintPolicy>>
  >;
  getUsagePolicy: () => Promise<
    Awaited<ReturnType<typeof evaluateUsageFingerprintPolicy>> | null
  >;
  resolveResolvedFingerprint: (args: {
    manualUsagePayload?: unknown | null;
  }) => Promise<ResolvedSimFingerprint>;
};

function logPolicyDecision(args: {
  eventName: "whole_home_fingerprint_policy_decision" | "usage_fingerprint_policy_decision";
  correlationId?: string;
  houseId: string;
  decision: FingerprintPolicyDecision;
  startedAt: number;
}) {
  logSimPipelineEvent(args.eventName, {
    correlationId: args.correlationId,
    houseId: args.houseId,
    action: args.decision.action,
    reason: args.decision.reason,
    currentStatus: args.decision.currentStatus,
    sourceHashMatch: args.decision.currentSourceHash === args.decision.expectedSourceHash,
    durationMs: Date.now() - args.startedAt,
    memoryRssMb: getMemoryRssMb(),
    source: "fingerprintRecalcContext",
  });
}

export function createFingerprintRecalcContext(
  args: FingerprintRecalcContextArgs
): FingerprintRecalcContext {
  let wholeHomePolicyPromise:
    | Promise<Awaited<ReturnType<typeof evaluateWholeHomeFingerprintPolicy>>>
    | null = null;
  let usagePolicyPromise:
    | Promise<Awaited<ReturnType<typeof evaluateUsageFingerprintPolicy>> | null>
    | null = null;
  const resolvedByManualKey = new Map<string, Promise<ResolvedSimFingerprint>>();

  const getWholeHomePolicy = () => {
    if (!wholeHomePolicyPromise) {
      const startedAt = Date.now();
      wholeHomePolicyPromise = evaluateWholeHomeFingerprintPolicy({
        houseId: args.houseId,
        homeProfile: args.homeProfile,
        applianceProfile: args.applianceProfile,
      }).then((policy) => {
        logPolicyDecision({
          eventName: "whole_home_fingerprint_policy_decision",
          correlationId: args.correlationId,
          houseId: args.houseId,
          decision: policy.decision,
          startedAt,
        });
        return policy;
      });
    }
    return wholeHomePolicyPromise;
  };

  const getUsagePolicy = () => {
    if (!usagePolicyPromise) {
      if (!(args.mode === "SMT_BASELINE" && args.actualOk)) {
        usagePolicyPromise = Promise.resolve(null);
      } else {
        const startedAt = Date.now();
        usagePolicyPromise = evaluateUsageFingerprintPolicy({
          houseId: args.actualContextHouseId,
          esiid: args.esiid,
          startDate: args.windowStart,
          endDate: args.windowEnd,
        }).then((policy) => {
          logPolicyDecision({
            eventName: "usage_fingerprint_policy_decision",
            correlationId: args.correlationId,
            houseId: args.actualContextHouseId,
            decision: policy.decision,
            startedAt,
          });
          return policy;
        });
      }
    }
    return usagePolicyPromise;
  };

  const resolveResolvedFingerprint = (resolveArgs: {
    manualUsagePayload?: unknown | null;
  }) => {
    const manualKey = JSON.stringify(
      resolveArgs.manualUsagePayload == null
        ? { manualUsagePayload: null }
        : { manualUsagePayload: resolveArgs.manualUsagePayload }
    );
    const cacheKey = `${String(args.mode)}:${manualKey}`;
    const existing = resolvedByManualKey.get(cacheKey);
    if (existing) return existing;
    const p = resolveSimFingerprint({
      houseId: args.houseId,
      actualContextHouseId: args.actualContextHouseId,
      mode: args.mode,
      correlationId: args.correlationId,
      manualUsagePayload: resolveArgs.manualUsagePayload ?? null,
    });
    resolvedByManualKey.set(cacheKey, p);
    return p;
  };

  return {
    ...args,
    getWholeHomePolicy,
    getUsagePolicy,
    resolveResolvedFingerprint,
  };
}


