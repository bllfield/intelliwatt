import { recalcSimulatorBuild } from "@/modules/onePathSim/usageSimulator/service";
import type { SimulatorMode } from "@/modules/onePathSim/usageSimulator/requirements";
import type { WeatherPreference } from "@/modules/weatherNormalization/normalizer";
import type { ValidationDaySelectionMode } from "@/modules/onePathSim/usageSimulator/validationSelection";
import type { PastSimRunContext } from "@/modules/onePathSim/usageSimulator/pastSimLockbox";
import type { AdminLabTreatmentMode } from "@/modules/onePathSim/usageSimulator/adminLabTreatment";
import type { TravelRange } from "@/modules/onePathSim/simulatedUsage/types";
import {
  createSimCorrelationId,
  logSimPipelineEvent,
  USER_PAST_SIM_RECALC_INLINE_TIMEOUT_MS,
} from "@/modules/onePathSim/usageSimulator/simObservability";
import { raceWithTimeout } from "@/modules/onePathSim/usageSimulator/promiseRaceTimeout";
import {
  enqueuePastSimRecalcDropletJob,
  PAST_SIM_RECALC_PAYLOAD_V,
  type PastSimRecalcQueuedPayloadV1,
} from "@/modules/onePathSim/usageSimulator/simDropletJob";
import { shouldEnqueuePastSimRecalcRemote } from "@/modules/onePathSim/usageSimulator/dropletSimWebhook";

const PAST_SIM_RECALC_INLINE_TIMEOUT_CODE = "past_sim_recalc_inline_timeout";

export type PastSimRecalcDispatchResult =
  | {
      executionMode: "droplet_async";
      jobId: string;
      correlationId: string;
    }
  | {
      executionMode: "inline";
      result: Awaited<ReturnType<typeof recalcSimulatorBuild>>;
      correlationId: string;
    };

/**
 * Canonical Past sim recalc entry: same `recalcSimulatorBuild` as always; optionally enqueues for droplet.
 */
export async function dispatchPastSimRecalc(args: {
  userId: string;
  houseId: string;
  esiid: string | null;
  mode: SimulatorMode;
  scenarioId?: string | null;
  weatherPreference?: WeatherPreference;
  persistPastSimBaseline?: boolean;
  actualContextHouseId?: string | null;
  validationOnlyDateKeysLocal?: Set<string> | string[];
  preLockboxTravelRanges?: TravelRange[];
  validationDaySelectionMode?: ValidationDaySelectionMode;
  validationDayCount?: number;
  adminLabTreatmentMode?: AdminLabTreatmentMode;
  correlationId?: string;
  runContext?: Partial<PastSimRunContext>;
}): Promise<PastSimRecalcDispatchResult> {
  const correlationId = args.correlationId ?? createSimCorrelationId();
  const validationOnlyDateKeysLocal = args.validationOnlyDateKeysLocal
    ? Array.from(args.validationOnlyDateKeysLocal)
    : undefined;
  const payload: PastSimRecalcQueuedPayloadV1 = {
    v: PAST_SIM_RECALC_PAYLOAD_V,
    userId: args.userId,
    houseId: args.houseId,
    esiid: args.esiid,
    mode: args.mode,
    scenarioId: args.scenarioId ?? null,
    weatherPreference: args.weatherPreference,
    persistPastSimBaseline: args.persistPastSimBaseline === true,
    actualContextHouseId: args.actualContextHouseId ?? null,
    validationOnlyDateKeysLocal,
    preLockboxTravelRanges: args.preLockboxTravelRanges ?? [],
    validationDaySelectionMode: args.validationDaySelectionMode,
    validationDayCount: args.validationDayCount,
    adminLabTreatmentMode: args.adminLabTreatmentMode,
    correlationId,
    runContext: args.runContext,
  };
  if (shouldEnqueuePastSimRecalcRemote()) {
    const enq = await enqueuePastSimRecalcDropletJob(payload);
    if (enq.ok) {
      return { executionMode: "droplet_async", jobId: enq.jobId, correlationId };
    }
  }
  let result: Awaited<ReturnType<typeof recalcSimulatorBuild>>;
  try {
    result = await raceWithTimeout(
      recalcSimulatorBuild({
        userId: args.userId,
        houseId: args.houseId,
        esiid: args.esiid,
        mode: args.mode,
        scenarioId: args.scenarioId ?? null,
        weatherPreference: args.weatherPreference,
        persistPastSimBaseline: args.persistPastSimBaseline,
        actualContextHouseId: args.actualContextHouseId ?? undefined,
        validationOnlyDateKeysLocal,
        preLockboxTravelRanges: args.preLockboxTravelRanges,
        validationDaySelectionMode: args.validationDaySelectionMode,
        validationDayCount: args.validationDayCount,
        adminLabTreatmentMode: args.adminLabTreatmentMode,
        correlationId,
        runContext: args.runContext,
      }),
      USER_PAST_SIM_RECALC_INLINE_TIMEOUT_MS,
      PAST_SIM_RECALC_INLINE_TIMEOUT_CODE
    );
  } catch (e: unknown) {
    const code =
      e instanceof Error ? (e as { code?: string }).code ?? (e as Error).message : String(e);
    const timedOut =
      code === PAST_SIM_RECALC_INLINE_TIMEOUT_CODE ||
      /past_sim_recalc_inline_timeout/i.test(String(code));
    if (timedOut) {
      logSimPipelineEvent("recalc_timeout", {
        correlationId,
        userId: args.userId,
        houseId: args.houseId,
        mode: String(args.mode),
        scenarioId: args.scenarioId ?? null,
        durationMs: USER_PAST_SIM_RECALC_INLINE_TIMEOUT_MS,
        source: "dispatchPastSimRecalc",
      });
      return {
        executionMode: "inline",
        result: { ok: false, error: "recalc_timeout" },
        correlationId,
      };
    }
    throw e;
  }
  return { executionMode: "inline", result, correlationId };
}

