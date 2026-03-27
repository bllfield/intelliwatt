/**
 * Shared droplet webhook trigger for canonical TS simulation work (Gap-Fill compare, Past sim recalc).
 * Same URL/secret as SMT triggers; body distinguishes workload via `reason`.
 */

export const SIM_DROPLET_JOB_KIND_GAPFILL_COMPARE = "gapfill_compare" as const;
export const SIM_DROPLET_JOB_KIND_PAST_SIM_RECALC = "past_sim_recalc" as const;

export type SimDropletJobKind =
  | typeof SIM_DROPLET_JOB_KIND_GAPFILL_COMPARE
  | typeof SIM_DROPLET_JOB_KIND_PAST_SIM_RECALC;

/** When true, never hand off heavy sim jobs to the droplet (dev / emergency). */
export function shouldEnqueueDropletSimJobsBase(): boolean {
  if (process.env.SIM_DROPLET_EXECUTION_INLINE === "true") return false;
  const url = process.env.DROPLET_WEBHOOK_URL || process.env.INTELLIWATT_WEBHOOK_URL;
  const secret = process.env.DROPLET_WEBHOOK_SECRET || process.env.INTELLIWATT_WEBHOOK_SECRET;
  return Boolean(url?.trim() && secret?.trim());
}

export function shouldEnqueueGapfillCompareRemote(): boolean {
  if (process.env.GAPFILL_COMPARE_INLINE === "true") return false;
  return shouldEnqueueDropletSimJobsBase();
}

export function shouldEnqueuePastSimRecalcRemote(): boolean {
  if (process.env.PAST_SIM_RECALC_INLINE === "true") return false;
  return shouldEnqueueDropletSimJobsBase();
}

export async function triggerDropletSimWebhook(payload: Record<string, unknown>): Promise<void> {
  const url = (process.env.DROPLET_WEBHOOK_URL || process.env.INTELLIWATT_WEBHOOK_URL || "").trim();
  const secret = (process.env.DROPLET_WEBHOOK_SECRET || process.env.INTELLIWATT_WEBHOOK_SECRET || "").trim();
  if (!url || !secret) return;
  await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-droplet-webhook-secret": secret,
      "x-intelliwatt-secret": secret,
    },
    body: JSON.stringify({
      ts: new Date().toISOString(),
      ...payload,
    }),
  });
}
