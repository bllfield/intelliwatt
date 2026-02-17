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
  // Plan-engine estimate version used by the pipeline when it ran.
  // This is stored inside payloadJson (no schema migration) so we can force reruns on version bumps.
  calcVersion?: string | null;
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

function readCount(payload: PlanPipelineJobPayload | null, key: string): number | null {
  const v = (payload as any)?.counts?.[key];
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function hasRemainingWork(latest: PlanPipelineJobPayload | null): boolean {
  if (!latest) return false;
  const ratePlanIdsCount = readCount(latest, "ratePlanIdsCount");
  const estimatesComputed = readCount(latest, "estimatesComputed") ?? 0;
  const estimatesAlreadyCached = readCount(latest, "estimatesAlreadyCached") ?? 0;
  if (ratePlanIdsCount == null) return false;
  // If we haven't computed/cached estimates for all known ratePlans yet, the pipeline is incomplete
  // and we should NOT block follow-on batches behind a long cooldown.
  return estimatesComputed + estimatesAlreadyCached < ratePlanIdsCount;
}

export function shouldStartPlanPipelineJob(args: {
  latest: PlanPipelineJobPayload | null;
  now?: Date;
  monthlyCadenceDays?: number; // default 30
  maxRunningMinutes?: number; // default 3 (pipeline runs are time-budgeted; stale RUNNING jobs must not block)
  requiredCalcVersion?: string | null;
  enforceCadence?: boolean; // default true
}): { okToStart: boolean; reason: string } {
  const now = args.now ?? new Date();
  const latest = args.latest;
  const cadenceDays = Number.isFinite(args.monthlyCadenceDays ?? NaN) ? (args.monthlyCadenceDays as number) : 30;
  const maxRunningMin = Number.isFinite(args.maxRunningMinutes ?? NaN) ? (args.maxRunningMinutes as number) : 3;
  const requiredCalcVersion = typeof args.requiredCalcVersion === "string" ? args.requiredCalcVersion.trim() : "";
  const enforceCadence = args.enforceCadence !== false;

  if (!latest) return { okToStart: true, reason: "no_prior_job" };

  if (latest.status === "RUNNING") {
    const startedAt = parseIsoDate(latest.startedAt);
    if (startedAt) {
      const ageMin = (now.getTime() - startedAt.getTime()) / 60000;
      if (ageMin <= maxRunningMin) return { okToStart: false, reason: "already_running" };
      // Stale RUNNING job: allow a new run. This prevents a single crashed invocation from blocking forever.
      return { okToStart: true, reason: "stale_running_job" };
    } else {
      return { okToStart: false, reason: "already_running" };
    }
  }

  const cooldownUntil = parseIsoDate(latest.cooldownUntil ?? null);
  // IMPORTANT: The pipeline is intentionally bounded (timeBudgetMs + maxEstimatePlans). It often takes
  // multiple runs to drain the queue. We must not apply a long cooldown while work remains, otherwise
  // the UI can get stuck with many offers in QUEUED.
  const bypassCooldown = latest.status === "DONE" && hasRemainingWork(latest);
  if (!bypassCooldown && cooldownUntil && cooldownUntil.getTime() > now.getTime()) {
    return { okToStart: false, reason: "cooldown_active" };
  }

  // If the engine/estimate version changed, we must refill caches immediately even if cadence hasn't elapsed.
  // Otherwise a version bump would brick the site for up to cadenceDays.
  if (requiredCalcVersion) {
    const latestVersion = typeof latest.calcVersion === "string" ? latest.calcVersion.trim() : "";
    if (latestVersion && latestVersion !== requiredCalcVersion) {
      return { okToStart: true, reason: "calc_version_changed" };
    }
    if (!latestVersion) {
      // Older snapshots didn't record calcVersion; treat as needing a refresh once.
      return { okToStart: true, reason: "calc_version_missing" };
    }
  }

  // Monthly cadence gate: only advance plan-calc window once per N days.
  if (enforceCadence) {
    const lastWindowEnd = parseIsoDate(latest.lastCalcWindowEnd ?? null);
    if (lastWindowEnd) {
      const ageDays = (now.getTime() - lastWindowEnd.getTime()) / (24 * 60 * 60 * 1000);
      if (ageDays < cadenceDays) {
        return { okToStart: false, reason: "monthly_cadence_not_elapsed" };
      }
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


