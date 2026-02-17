import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const ADMIN_TOKEN = process.env.ADMIN_TOKEN;

function jsonError(status: number, error: string, details?: unknown) {
  return NextResponse.json({ ok: false, error, ...(details ? { details } : {}) }, { status });
}

function isAuthorized(req: NextRequest): boolean {
  // Vercel Cron requests include this header.
  if (req.headers.get("x-vercel-cron") === "1") return true;
  const headerToken = req.headers.get("x-admin-token");
  return Boolean(ADMIN_TOKEN && headerToken && headerToken === ADMIN_TOKEN);
}

type TerritorySeed = {
  key: "oncor" | "centerpoint" | "tnmp" | "aep_c" | "aep_n";
  label: string;
  state: "TX";
  zip: string;
};

// Representative zips per TDSP territory for nightly WattBuy catalog pulls.
// This job is best-effort: template hits will skip work; unresolved items get queued for ops.
const TERRITORY_SEEDS: TerritorySeed[] = [
  { key: "oncor", label: "Oncor (Dallas)", state: "TX", zip: "75201" },
  { key: "centerpoint", label: "CenterPoint (Houston)", state: "TX", zip: "77002" },
  { key: "tnmp", label: "TNMP (Galveston)", state: "TX", zip: "77550" },
  { key: "aep_c", label: "AEP Central (Corpus Christi)", state: "TX", zip: "78401" },
  { key: "aep_n", label: "AEP North (Abilene)", state: "TX", zip: "79601" },
];

async function postJson(
  req: NextRequest,
  path: string,
  body: unknown,
  opts?: { timeoutMs?: number },
): Promise<{ ok: boolean; status: number; json: any | null; text: string | null }> {
  if (!ADMIN_TOKEN) {
    return { ok: false, status: 500, json: null, text: "ADMIN_TOKEN not configured" };
  }
  const url = new URL(path, req.nextUrl.origin);
  const timeoutMs = Math.max(5_000, Math.min(270_000, Number(opts?.timeoutMs ?? 120_000)));
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url.toString(), {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-admin-token": ADMIN_TOKEN,
      },
      body: JSON.stringify(body ?? {}),
      signal: controller.signal,
    });
    const raw = await res.text();
    try {
      const json = raw ? JSON.parse(raw) : null;
      return { ok: res.ok, status: res.status, json, text: null };
    } catch {
      return { ok: res.ok, status: res.status, json: null, text: raw };
    }
  } catch (e: any) {
    return { ok: false, status: 599, json: null, text: e?.message ? String(e.message) : String(e) };
  } finally {
    clearTimeout(t);
  }
}

export async function GET(req: NextRequest) {
  try {
    if (!ADMIN_TOKEN) return jsonError(500, "ADMIN_TOKEN is not configured");
    if (!isAuthorized(req)) return jsonError(401, "Unauthorized");

    const startedAtMs = Date.now();
    const timeBudgetMs = 270_000; // leave buffer within maxDuration
    const deadlineMs = startedAtMs + timeBudgetMs;
    const shouldStop = () => Date.now() >= deadlineMs - 3_000;

    const url = new URL(req.url);
    const only = String(url.searchParams.get("utility") ?? "").trim().toLowerCase() || null;
    const seeds = only
      ? TERRITORY_SEEDS.filter((s) => s.key === only || s.label.toLowerCase().includes(only))
      : TERRITORY_SEEDS.slice();

    const runs: any[] = [];

    // 1) Pull/parse offers for each territory seed and persist templates on PASS.
    for (const seed of seeds) {
      if (shouldStop()) break;

      const remaining = Math.max(0, deadlineMs - Date.now());
      const callBudget = Math.max(15_000, Math.min(120_000, remaining - 10_000));
      if (callBudget < 15_000) break;

      const r = await postJson(
        req,
        "/api/admin/wattbuy/offers-batch-efl-parse",
        {
          address: { state: seed.state, zip: seed.zip },
          mode: "STORE_TEMPLATES_ON_PASS",
          // Fetch a big slice of the catalog, but cap processing by timeBudget.
          offerLimit: 500,
          startIndex: 0,
          processLimit: 500,
          timeBudgetMs: callBudget,
          dryRun: false,
          // Hygiene: nightly should not reparse everything every day.
          forceReparseTemplates: false,
        },
        { timeoutMs: callBudget + 10_000 },
      );

      runs.push({
        type: "offers_batch_efl_parse",
        territory: seed,
        ok: r.ok,
        status: r.status,
        summary:
          r.json && r.json.ok
            ? {
                offerCount: r.json.offerCount ?? null,
                scannedCount: r.json.scannedCount ?? null,
                processedCount: r.json.processedCount ?? null,
                truncated: r.json.truncated ?? null,
                nextStartIndex: r.json.nextStartIndex ?? null,
              }
            : null,
        error: !r.ok ? (r.json?.error ?? r.text ?? "request_failed") : null,
      });
    }

    // 2) Drain OPEN EFL_PARSE queue (auto-persist PASS+STRONG templates).
    let processOpenResult: any = null;
    if (!shouldStop()) {
      const remaining = Math.max(0, deadlineMs - Date.now());
      const callBudget = Math.max(15_000, Math.min(remaining - 5_000, 120_000));
      if (callBudget >= 15_000) {
        const r = await postJson(
          req,
          "/api/admin/efl-review/process-open",
          {
            drain: true,
            dryRun: false,
            limit: 50,
            resultsLimit: 50,
            timeBudgetMs: callBudget,
            forceReparseTemplates: false,
          },
          { timeoutMs: callBudget + 10_000 },
        );
        processOpenResult = {
          ok: r.ok,
          status: r.status,
          body: r.json ?? { raw: r.text },
        };
      }
    }

    // 3) Drain QUARANTINE queue (PLAN_CALC_QUARANTINE) best-effort.
    let processQuarantineResult: any = null;
    if (!shouldStop()) {
      const remaining = Math.max(0, deadlineMs - Date.now());
      const callBudget = Math.max(15_000, Math.min(remaining - 3_000, 120_000));
      if (callBudget >= 15_000) {
        const r = await postJson(
          req,
          "/api/admin/efl-review/process-quarantine",
          {
            drain: true,
            dryRun: false,
            limit: 50,
            resultsLimit: 50,
            timeBudgetMs: callBudget,
          },
          { timeoutMs: callBudget + 10_000 },
        );
        processQuarantineResult = {
          ok: r.ok,
          status: r.status,
          body: r.json ?? { raw: r.text },
        };
      }
    }

    const elapsedMs = Date.now() - startedAtMs;
    return NextResponse.json({
      ok: true,
      startedAt: new Date(startedAtMs).toISOString(),
      elapsedMs,
      seedsAttempted: seeds.length,
      runs,
      processOpenResult,
      processQuarantineResult,
      stoppedEarly: shouldStop(),
    });
  } catch (e: any) {
    return jsonError(500, "Internal error running nightly template job", e?.message ?? String(e));
  }
}

