import { usagePrisma } from "@/lib/db/usageClient";
import type { SimulatorMode } from "@/modules/usageSimulator/requirements";
import type { WeatherPreference } from "@/modules/weatherNormalization/normalizer";
import type { ValidationDaySelectionMode } from "@/modules/usageSimulator/validationSelection";
import type { PastSimRunContext } from "@/modules/usageSimulator/pastSimLockbox";
import type { AdminLabTreatmentMode } from "@/modules/usageSimulator/adminLabTreatment";
import type { TravelRange } from "@/modules/simulatedUsage/types";
import {
  SIM_DROPLET_JOB_KIND_PAST_SIM_RECALC,
  triggerDropletSimWebhook,
} from "@/modules/usageSimulator/dropletSimWebhook";

export const PAST_SIM_RECALC_PAYLOAD_V = 1 as const;

export type PastSimRecalcQueuedPayloadV1 = {
  v: typeof PAST_SIM_RECALC_PAYLOAD_V;
  userId: string;
  houseId: string;
  esiid: string | null;
  mode: SimulatorMode;
  scenarioId?: string | null;
  weatherPreference?: WeatherPreference;
  persistPastSimBaseline?: boolean;
  actualContextHouseId?: string | null;
  preLockboxTravelRanges?: TravelRange[];
  validationDaySelectionMode?: ValidationDaySelectionMode;
  validationDayCount?: number;
  adminLabTreatmentMode?: AdminLabTreatmentMode;
  /** Observability: same id logged on enqueue and worker recalc (plan §6). */
  correlationId?: string;
  runContext?: Partial<PastSimRunContext>;
};

function getSimDropletJobModel(): {
  create: (args: any) => Promise<any>;
  update: (args: any) => Promise<any>;
  findUnique: (args: any) => Promise<any>;
} | null {
  try {
    const model = (usagePrisma as any).simDropletJob;
    return model &&
      typeof model.create === "function" &&
      typeof model.update === "function" &&
      typeof model.findUnique === "function"
      ? model
      : null;
  } catch {
    return null;
  }
}

export async function createPastSimRecalcQueuedJob(args: PastSimRecalcQueuedPayloadV1): Promise<
  | { ok: true; jobId: string }
  | { ok: false; error: string; message: string }
> {
  const model = getSimDropletJobModel();
  if (!model) {
    return {
      ok: false,
      error: "sim_droplet_job_unavailable",
      message: "SimDropletJob persistence is unavailable.",
    };
  }
  try {
    const row = await model.create({
      data: {
        jobKind: SIM_DROPLET_JOB_KIND_PAST_SIM_RECALC,
        status: "queued",
        payloadJson: args as unknown as Record<string, unknown>,
      },
      select: { id: true },
    });
    return { ok: true, jobId: String(row.id) };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "sim droplet job create failed";
    return { ok: false, error: "sim_droplet_job_create_failed", message: msg };
  }
}

export async function markPastSimRecalcJobRunning(jobId: string): Promise<boolean> {
  const model = getSimDropletJobModel();
  if (!model) return false;
  try {
    await model.update({
      where: { id: jobId },
      data: { status: "running", failureMessage: null },
    });
    return true;
  } catch {
    return false;
  }
}

export async function markPastSimRecalcJobSucceeded(jobId: string): Promise<boolean> {
  const model = getSimDropletJobModel();
  if (!model) return false;
  try {
    await model.update({
      where: { id: jobId },
      data: { status: "succeeded", failureMessage: null },
    });
    return true;
  } catch {
    return false;
  }
}

export async function markPastSimRecalcJobFailed(jobId: string, failureMessage: string): Promise<boolean> {
  const model = getSimDropletJobModel();
  if (!model) return false;
  try {
    await model.update({
      where: { id: jobId },
      data: { status: "failed", failureMessage: failureMessage.slice(0, 8000) },
    });
    return true;
  } catch {
    return false;
  }
}

export async function getPastSimRecalcJobForUser(args: {
  jobId: string;
  userId: string;
}): Promise<{
  ok: true;
  status: string;
  failureMessage: string | null;
  payload: PastSimRecalcQueuedPayloadV1;
} | {
  ok: false;
  code: "not_found" | "wrong_user";
}> {
  const model = getSimDropletJobModel();
  if (!model) return { ok: false, code: "not_found" };
  try {
    const row = await model.findUnique({
      where: { id: args.jobId },
      select: { jobKind: true, status: true, failureMessage: true, payloadJson: true },
    });
    if (!row || row.jobKind !== SIM_DROPLET_JOB_KIND_PAST_SIM_RECALC) {
      return { ok: false, code: "not_found" };
    }
    const p = row.payloadJson as PastSimRecalcQueuedPayloadV1 | null;
    if (!p || p.v !== PAST_SIM_RECALC_PAYLOAD_V) {
      return { ok: false, code: "not_found" };
    }
    if (p.userId !== args.userId) {
      return { ok: false, code: "wrong_user" };
    }
    return {
      ok: true,
      status: String(row.status ?? ""),
      failureMessage: row.failureMessage != null ? String(row.failureMessage) : null,
      payload: p,
    };
  } catch {
    return { ok: false, code: "not_found" };
  }
}

/** Persist queued job + notify droplet; same webhook path as Gap-Fill compare. */
export async function enqueuePastSimRecalcDropletJob(
  payload: PastSimRecalcQueuedPayloadV1
): Promise<{ ok: true; jobId: string } | { ok: false; error: string; message: string }> {
  const created = await createPastSimRecalcQueuedJob(payload);
  if (!created.ok) return created;
  const webhook = await triggerDropletSimWebhook({
    reason: SIM_DROPLET_JOB_KIND_PAST_SIM_RECALC,
    jobId: created.jobId,
  });
  const handoffFailed = !webhook.ok || ("skipped" in webhook && webhook.skipped === true);
  if (handoffFailed) {
    const detail =
      "skipped" in webhook && webhook.skipped
        ? "droplet_webhook_missing_configuration_at_trigger"
        : !webhook.ok && webhook.fetchError
          ? webhook.fetchError
          : !webhook.ok && webhook.bodySnippet
            ? webhook.bodySnippet
            : !webhook.ok
              ? `http_${webhook.httpStatus ?? "error"}`
              : "droplet_webhook_failed";
    await markPastSimRecalcJobFailed(created.jobId, detail.slice(0, 2000));
    return {
      ok: false,
      error: "droplet_webhook_failed",
      message: "Droplet did not accept the recalc job (webhook failed or misconfigured).",
    };
  }
  return { ok: true, jobId: created.jobId };
}
