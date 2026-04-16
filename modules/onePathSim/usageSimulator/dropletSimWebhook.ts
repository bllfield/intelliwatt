/**
 * Shared droplet webhook trigger for canonical TS simulation work (Gap-Fill compare, Past sim recalc).
 * Same URL/secret as SMT triggers; body distinguishes workload via `reason`.
 */

export const SIM_DROPLET_JOB_KIND_GAPFILL_COMPARE = "gapfill_compare" as const;
export const SIM_DROPLET_JOB_KIND_PAST_SIM_RECALC = "past_sim_recalc" as const;

export type SimDropletJobKind =
  | typeof SIM_DROPLET_JOB_KIND_GAPFILL_COMPARE
  | typeof SIM_DROPLET_JOB_KIND_PAST_SIM_RECALC;

/**
 * Raw `||` precedence then trim — must match `getGapfillCompareEnqueueDiagnostics` and `triggerDropletSimWebhook`.
 * Note: a whitespace-only value is truthy for `||` and blocks the fallback env (same as Node `process.env` merge).
 */
function resolveDropletWebhookUrlRaw(): string | undefined {
  return process.env.DROPLET_WEBHOOK_URL || process.env.INTELLIWATT_WEBHOOK_URL;
}

function resolveDropletWebhookSecretRaw(): string | undefined {
  return process.env.DROPLET_WEBHOOK_SECRET || process.env.INTELLIWATT_WEBHOOK_SECRET;
}

/** When true, never hand off heavy sim jobs to the droplet (dev / emergency). */
export function shouldEnqueueDropletSimJobsBase(): boolean {
  if (process.env.SIM_DROPLET_EXECUTION_INLINE === "true") return false;
  const url = resolveDropletWebhookUrlRaw();
  const secret = resolveDropletWebhookSecretRaw();
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

/** Which env name “won” for `a || b` (truthiness), not trim-first fallback — matches enqueue gating. */
function webhookUrlSourceFromEnv(): GapfillCompareEnqueueDiagnostics["webhookUrlSource"] {
  if (process.env.DROPLET_WEBHOOK_URL) return "DROPLET_WEBHOOK_URL";
  if (process.env.INTELLIWATT_WEBHOOK_URL) return "INTELLIWATT_WEBHOOK_URL";
  return "none";
}

function webhookSecretSourceFromEnv(): GapfillCompareEnqueueDiagnostics["webhookSecretSource"] {
  if (process.env.DROPLET_WEBHOOK_SECRET) return "DROPLET_WEBHOOK_SECRET";
  if (process.env.INTELLIWATT_WEBHOOK_SECRET) return "INTELLIWATT_WEBHOOK_SECRET";
  return "none";
}

/** Booleans + non-sensitive sources only — use in Vercel logs and admin GET. */
export function getGapfillCompareEnqueueDiagnostics(): GapfillCompareEnqueueDiagnostics {
  const gapfillCompareInline = process.env.GAPFILL_COMPARE_INLINE === "true";
  const simDropletExecutionInline = process.env.SIM_DROPLET_EXECUTION_INLINE === "true";
  const urlTrimmed = resolveDropletWebhookUrlRaw()?.trim() ?? "";
  const secretTrimmed = resolveDropletWebhookSecretRaw()?.trim() ?? "";
  const hasWebhookUrl = urlTrimmed.length > 0;
  const hasWebhookSecret = secretTrimmed.length > 0;
  let webhookUrlScheme: GapfillCompareEnqueueDiagnostics["webhookUrlScheme"] = "none";
  if (hasWebhookUrl) {
    try {
      const u = new URL(urlTrimmed);
      webhookUrlScheme = u.protocol === "https:" ? "https" : "http";
    } catch {
      webhookUrlScheme = "none";
    }
  }
  const dropletSimJobsBaseEligible = shouldEnqueueDropletSimJobsBase();
  const wouldEnqueueGapfillCompare = shouldEnqueueGapfillCompareRemote();
  return {
    wouldEnqueueGapfillCompare,
    gapfillCompareInline,
    simDropletExecutionInline,
    hasWebhookUrl,
    hasWebhookSecret,
    webhookUrlSource: webhookUrlSourceFromEnv(),
    webhookSecretSource: webhookSecretSourceFromEnv(),
    webhookUrlScheme,
    dropletSimJobsBaseEligible,
  };
}

/** Result of POST to the droplet webhook (callers can mark queued jobs failed when `ok` is false). */
export type DropletSimWebhookResult =
  | { ok: true; skipped: true }
  | {
      ok: true;
      skipped?: false;
      httpStatus: number;
      bodySnippet: string;
    }
  | {
      ok: false;
      skipped?: false;
      httpStatus?: number;
      bodySnippet?: string;
      fetchError?: string;
    };

export async function triggerDropletSimWebhook(
  payload: Record<string, unknown>
): Promise<DropletSimWebhookResult> {
  const url = (resolveDropletWebhookUrlRaw() ?? "").trim();
  const secret = (resolveDropletWebhookSecretRaw() ?? "").trim();
  if (!url || !secret) {
    return { ok: true, skipped: true };
  }
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
    const text = await res.text().catch(() => "");
    let parsed: { ok?: unknown } | null = null;
    try {
      parsed = text ? (JSON.parse(text) as { ok?: unknown }) : null;
    } catch {
      parsed = null;
    }
    const bodyOk =
      parsed !== null &&
      typeof parsed === "object" &&
      (parsed as { ok?: unknown }).ok === true;
    const ok = res.ok && bodyOk;
    if (!res.ok) {
      console.warn("[droplet_sim_webhook] non_ok_response", {
        status: res.status,
        reason: payload.reason,
        bodySnippet: text.slice(0, 200),
      });
    } else if (!bodyOk) {
      console.warn("[droplet_sim_webhook] body_not_ok", {
        reason: payload.reason,
        bodySnippet: text.slice(0, 200),
      });
    }
    if (ok) {
      return { ok: true, httpStatus: res.status, bodySnippet: text.slice(0, 500) };
    }
    return {
      ok: false,
      httpStatus: res.status,
      bodySnippet: text.slice(0, 500),
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn("[droplet_sim_webhook] fetch_failed", {
      reason: payload.reason,
      message,
    });
    return { ok: false, fetchError: message };
  }
}

