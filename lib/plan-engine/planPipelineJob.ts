import crypto from "node:crypto";
import { wattbuyOffersPrisma } from "@/lib/db/wattbuyOffersClient";

const ENDPOINT = "PLAN_PIPELINE_JOB_V1";

export type PlanPipelineJobStatus = "RUNNING" | "DONE" | "ERROR";

export type PlanPipelineJobPayload = {
  v: 1;
  homeId: string;
  runId: string;
  status: PlanPipelineJobStatus;
  reason: string;
  startedAt: string;
  finishedAt?: string | null;
  cooldownUntil?: string | null;
  lastCalcWindowEnd?: string | null;
  lastError?: string | null;
  counts?: Record<string, number>;
};

export function sha256Hex(s: string): string {
  return crypto.createHash("sha256").update(s).digest("hex");
}

function requestKeyForHome(homeId: string): string {
  return `plan_pipeline|homeId=${homeId}`;
}

export async function getLatestPlanPipelineJob(homeIdRaw: string): Promise<PlanPipelineJobPayload | null> {
  const homeId = String(homeIdRaw ?? "").trim();
  if (!homeId) return null;
  try {
    const row = await (wattbuyOffersPrisma as any).wattBuyApiSnapshot.findFirst({
      where: { endpoint: ENDPOINT, houseAddressId: homeId, requestKey: requestKeyForHome(homeId) },
      orderBy: { createdAt: "desc" },
      select: { payloadJson: true },
    });
    const payload = row?.payloadJson ?? null;
    return payload && typeof payload === "object" ? (payload as any) : null;
  } catch {
    return null;
  }
}

function parseIsoDate(s: any): Date | null {
  if (typeof s !== "string" || !s.trim()) return null;
  const d = new Date(s);
  return Number.isFinite(d.getTime()) ? d : null;
}

export function shouldStartPlanPipelineJob(args: {
  latest: PlanPipelineJobPayload | null;
  now?: Date;
  monthlyCadenceDays?: number; // default 30
  maxRunningMinutes?: number; // default 20
}): { okToStart: boolean; reason: string } {
  const now = args.now ?? new Date();
  const latest = args.latest;
  const cadenceDays = Number.isFinite(args.monthlyCadenceDays ?? NaN) ? (args.monthlyCadenceDays as number) : 30;
  const maxRunningMin = Number.isFinite(args.maxRunningMinutes ?? NaN) ? (args.maxRunningMinutes as number) : 20;

  if (!latest) return { okToStart: true, reason: "no_prior_job" };

  const cooldownUntil = parseIsoDate(latest.cooldownUntil ?? null);
  if (cooldownUntil && cooldownUntil.getTime() > now.getTime()) {
    return { okToStart: false, reason: "cooldown_active" };
  }

  if (latest.status === "RUNNING") {
    const startedAt = parseIsoDate(latest.startedAt);
    if (startedAt) {
      const ageMin = (now.getTime() - startedAt.getTime()) / 60000;
      if (ageMin <= maxRunningMin) return { okToStart: false, reason: "already_running" };
    } else {
      return { okToStart: false, reason: "already_running" };
    }
  }

  // Monthly cadence gate: only advance plan-calc window once per N days.
  const lastWindowEnd = parseIsoDate(latest.lastCalcWindowEnd ?? null);
  if (lastWindowEnd) {
    const ageDays = (now.getTime() - lastWindowEnd.getTime()) / (24 * 60 * 60 * 1000);
    if (ageDays < cadenceDays) {
      return { okToStart: false, reason: "monthly_cadence_not_elapsed" };
    }
  }

  return { okToStart: true, reason: "eligible" };
}

export async function writePlanPipelineJobSnapshot(payload: PlanPipelineJobPayload): Promise<void> {
  const homeId = String(payload?.homeId ?? "").trim();
  if (!homeId) return;
  try {
    await (wattbuyOffersPrisma as any).wattBuyApiSnapshot.create({
      data: {
        endpoint: ENDPOINT,
        houseAddressId: homeId,
        requestKey: requestKeyForHome(homeId),
        payloadSha256: sha256Hex(JSON.stringify({ v: payload.v, homeId, runId: payload.runId, status: payload.status })),
        payloadJson: payload as any,
      },
    });
  } catch {
    // best-effort
  }
}


