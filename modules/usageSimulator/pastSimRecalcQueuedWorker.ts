import { recalcSimulatorBuild } from "@/modules/usageSimulator/service";
import {
  markPastSimRecalcJobFailed,
  markPastSimRecalcJobRunning,
  markPastSimRecalcJobSucceeded,
  type PastSimRecalcQueuedPayloadV1,
  PAST_SIM_RECALC_PAYLOAD_V,
} from "@/modules/usageSimulator/simDropletJob";
import { usagePrisma } from "@/lib/db/usageClient";

async function loadPayload(jobId: string): Promise<PastSimRecalcQueuedPayloadV1 | null> {
  try {
    const row = await (usagePrisma as any).simDropletJob.findUnique({
      where: { id: jobId },
      select: { jobKind: true, payloadJson: true },
    });
    if (!row || row.jobKind !== "past_sim_recalc") return null;
    const p = row.payloadJson as PastSimRecalcQueuedPayloadV1;
    if (!p || p.v !== PAST_SIM_RECALC_PAYLOAD_V) return null;
    return p;
  } catch {
    return null;
  }
}

/**
 * Droplet entry: run canonical `recalcSimulatorBuild` (same module as Vercel) for a queued job.
 */
export async function runPastSimRecalcQueuedWorker(jobId: string): Promise<void> {
  const payload = await loadPayload(jobId);
  if (!payload) {
    await markPastSimRecalcJobFailed(jobId, "missing_or_invalid_payload");
    return;
  }
  await markPastSimRecalcJobRunning(jobId);
  const out = await recalcSimulatorBuild({
    userId: payload.userId,
    houseId: payload.houseId,
    esiid: payload.esiid,
    mode: payload.mode,
    scenarioId: payload.scenarioId ?? null,
    weatherPreference: payload.weatherPreference,
    persistPastSimBaseline: payload.persistPastSimBaseline === true,
    actualContextHouseId: payload.actualContextHouseId ?? undefined,
    preLockboxTravelRanges: payload.preLockboxTravelRanges,
    validationDaySelectionMode: payload.validationDaySelectionMode,
    validationDayCount: payload.validationDayCount,
    adminLabTreatmentMode: payload.adminLabTreatmentMode,
    correlationId: payload.correlationId,
    runContext: payload.runContext,
  });
  if (!out.ok) {
    await markPastSimRecalcJobFailed(
      jobId,
      typeof (out as any).error === "string" ? (out as any).error : "recalc_failed"
    );
    return;
  }
  await markPastSimRecalcJobSucceeded(jobId);
}
