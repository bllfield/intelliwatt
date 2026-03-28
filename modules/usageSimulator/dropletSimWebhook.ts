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

/** Safe for logs and admin diagnostics: no secrets or full URLs. */
export type GapfillCompareEnqueueDiagnostics = {
  wouldEnqueueGapfillCompare: boolean;
  gapfillCompareInline: boolean;
  simDropletExecutionInline: boolean;
  hasWebhookUrl: boolean;
  hasWebhookSecret: boolean;
  webhookUrlSource: "DROPLET_WEBHOOK_URL" | "INTELLIWATT_WEBHOOK_URL" | "none";
  webhookSecretSource: "DROPLET_WEBHOOK_SECRET" | "INTELLIWATT_WEBHOOK_SECRET" | "none";
  /** Outbound trigger URL scheme (http vs https affects some hosts). */
  webhookUrlScheme: "http" | "https" | "none";
  dropletSimJobsBaseEligible: boolean;
};

function resolveWebhookUrlMeta(): {
  trimmed: string;
  source: GapfillCompareEnqueueDiagnostics["webhookUrlSource"];
} {
  const droplet = (process.env.DROPLET_WEBHOOK_URL ?? "").trim();
  if (droplet) return { trimmed: droplet, source: "DROPLET_WEBHOOK_URL" };
  const intl = (process.env.INTELLIWATT_WEBHOOK_URL ?? "").trim();
  if (intl) return { trimmed: intl, source: "INTELLIWATT_WEBHOOK_URL" };
  return { trimmed: "", source: "none" };
}

function resolveWebhookSecretMeta(): {
  trimmed: string;
  source: GapfillCompareEnqueueDiagnostics["webhookSecretSource"];
} {
  const droplet = (process.env.DROPLET_WEBHOOK_SECRET ?? "").trim();
  if (droplet) return { trimmed: droplet, source: "DROPLET_WEBHOOK_SECRET" };
  const intl = (process.env.INTELLIWATT_WEBHOOK_SECRET ?? "").trim();
  if (intl) return { trimmed: intl, source: "INTELLIWATT_WEBHOOK_SECRET" };
  return { trimmed: "", source: "none" };
}

/** Booleans + non-sensitive sources only — use in Vercel logs and admin GET. */
export function getGapfillCompareEnqueueDiagnostics(): GapfillCompareEnqueueDiagnostics {
  const gapfillCompareInline = process.env.GAPFILL_COMPARE_INLINE === "true";
  const simDropletExecutionInline = process.env.SIM_DROPLET_EXECUTION_INLINE === "true";
  const urlMeta = resolveWebhookUrlMeta();
  const secretMeta = resolveWebhookSecretMeta();
  const hasWebhookUrl = urlMeta.trimmed.length > 0;
  const hasWebhookSecret = secretMeta.trimmed.length > 0;
  let webhookUrlScheme: GapfillCompareEnqueueDiagnostics["webhookUrlScheme"] = "none";
  if (hasWebhookUrl) {
    try {
      const u = new URL(urlMeta.trimmed);
      webhookUrlScheme = u.protocol === "https:" ? "https" : "http";
    } catch {
      webhookUrlScheme = "none";
    }
  }
  const dropletSimJobsBaseEligible = !simDropletExecutionInline && hasWebhookUrl && hasWebhookSecret;
  const wouldEnqueueGapfillCompare = !gapfillCompareInline && dropletSimJobsBaseEligible;
  return {
    wouldEnqueueGapfillCompare,
    gapfillCompareInline,
    simDropletExecutionInline,
    hasWebhookUrl,
    hasWebhookSecret,
    webhookUrlSource: urlMeta.source,
    webhookSecretSource: secretMeta.source,
    webhookUrlScheme,
    dropletSimJobsBaseEligible,
  };
}

export async function triggerDropletSimWebhook(payload: Record<string, unknown>): Promise<void> {
  const url = (process.env.DROPLET_WEBHOOK_URL || process.env.INTELLIWATT_WEBHOOK_URL || "").trim();
  const secret = (process.env.DROPLET_WEBHOOK_SECRET || process.env.INTELLIWATT_WEBHOOK_SECRET || "").trim();
  if (!url || !secret) return;
  try {
    const res = await fetch(url, {
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
    if (!res.ok) {
      const snip = await res.text().catch(() => "");
      console.warn("[droplet_sim_webhook] non_ok_response", {
        status: res.status,
        reason: payload.reason,
        bodySnippet: snip.slice(0, 200),
      });
    }
  } catch (err: unknown) {
    // Do not throw: callers may have already persisted a queued job; log for ops.
    console.warn("[droplet_sim_webhook] fetch_failed", {
      reason: payload.reason,
      message: err instanceof Error ? err.message : String(err),
    });
  }
}
