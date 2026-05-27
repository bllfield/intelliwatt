"use client";

type OrchestrateBody = {
  homeId?: string;
  force?: boolean;
};

let inFlight: Promise<void> | null = null;

const SESSION_DONE_KEY = "smt_orchestrator_bootstrap_done_v1";
const SESSION_TTL_MS = 30_000;
/** Orchestrate is status-only (~few seconds); leave headroom for slow networks. */
const ORCHESTRATE_WAIT_TIMEOUT_MS = 35_000;

function readRecentDoneAt(): number | null {
  try {
    const raw = window.sessionStorage.getItem(SESSION_DONE_KEY);
    const at = raw ? Number(raw) : Number.NaN;
    return Number.isFinite(at) ? at : null;
  } catch {
    return null;
  }
}

function markDone(): void {
  try {
    window.sessionStorage.setItem(SESSION_DONE_KEY, String(Date.now()));
  } catch {
    // ignore
  }
}

async function postOrchestrate(body: OrchestrateBody): Promise<void> {
  const res = await fetch("/api/user/smt/orchestrate", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      ...(body.homeId ? { homeId: body.homeId } : {}),
      ...(body.force ? { force: true } : {}),
    }),
    cache: "no-store",
  });
  await res.json().catch(() => null);
}

/**
 * Run dashboard SMT orchestrate once per session window. Concurrent callers share one request.
 * Usage REAL load should await this before GET /api/user/usage so poll/heal ordering is stable.
 */
export async function ensureDashboardSmtOrchestrate(body: OrchestrateBody = {}): Promise<void> {
  if (inFlight) {
    await inFlight.catch(() => null);
    return;
  }

  if (!body.force) {
    const doneAt = readRecentDoneAt();
    if (doneAt != null && Date.now() - doneAt < SESSION_TTL_MS) {
      return;
    }
  }

  inFlight = (async () => {
    try {
      await Promise.race([
        postOrchestrate(body),
        new Promise<void>((resolve) => setTimeout(resolve, ORCHESTRATE_WAIT_TIMEOUT_MS)),
      ]);
    } catch {
      // non-fatal; Usage load proceeds
    } finally {
      markDone();
      inFlight = null;
    }
  })();

  await inFlight.catch(() => null);
}

/** Fire-and-forget wrapper for layout bootstrap (Usage page awaits the same shared promise). */
export function kickDashboardSmtOrchestrate(body: OrchestrateBody = {}): void {
  void ensureDashboardSmtOrchestrate(body);
}
