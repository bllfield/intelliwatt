import { NextRequest, NextResponse } from "next/server";

import { requireVercelCron } from "@/lib/auth/cron";
import { prisma } from "@/lib/db";
import { buildUsageBucketsForEstimate } from "@/lib/usage/buildUsageBucketsForEstimate";
import { getTdspDeliveryRates } from "@/lib/plan-engine/getTdspDeliveryRates";
import { estimateTrueCost } from "@/lib/plan-engine/estimateTrueCost";
import { derivePlanCalcRequirementsFromTemplate } from "@/lib/plan-engine/planComputability";
import { normalizeEmail } from "@/lib/utils/email";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const ADMIN_TOKEN = process.env.ADMIN_TOKEN;
const DEFAULT_SAMPLE_HOME_EMAIL = (process.env.SAMPLE_HOME_EMAIL ?? "bllfield32@gmail.com").trim().toLowerCase();

const FLAG_WATTBUY_NIGHTLY_TIME = "cron:wattbuy_nightly:time_chicago";
const FLAG_WATTBUY_NIGHTLY_LAST_RUN_AT = "cron:wattbuy_nightly:last_run_at";
const FLAG_WATTBUY_NIGHTLY_RUNLOG = "cron:wattbuy_nightly:runlog_json";
const FLAG_SAMPLE_HOME_EMAIL = "cron:sample_home:email";

function jsonError(status: number, error: string, details?: unknown) {
  return NextResponse.json({ ok: false, error, ...(details ? { details } : {}) }, { status });
}

function requireCronOrAdmin(req: NextRequest): Response | null {
  // If this was triggered by Vercel Cron, enforce cron auth (and optional CRON_SECRET).
  if (req.headers.get("x-vercel-cron")) {
    return requireVercelCron(req);
  }

  // Otherwise, allow manual invocations with x-admin-token.
  const headerToken = req.headers.get("x-admin-token");
  if (!ADMIN_TOKEN || !headerToken || headerToken !== ADMIN_TOKEN) {
    return jsonError(401, "Unauthorized");
  }
  return null;
}

function parseTimeHHMM(s: string): { hour: number; minute: number } | null {
  const m = String(s ?? "")
    .trim()
    .match(/^([01]\d|2[0-3]):([0-5]\d)$/);
  if (!m) return null;
  return { hour: Number(m[1]), minute: Number(m[2]) };
}

function chicagoNowParts(now = new Date()): { ymd: string; hour: number; minute: number } {
  const dtf = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Chicago",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const parts = dtf.formatToParts(now);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  const y = get("year");
  const mo = get("month");
  const d = get("day");
  const h = Number(get("hour"));
  const mi = Number(get("minute"));
  return { ymd: `${y}-${mo}-${d}`, hour: Number.isFinite(h) ? h : 0, minute: Number.isFinite(mi) ? mi : 0 };
}

async function getFlag(key: string): Promise<string | null> {
  const row = await prisma.featureFlag.findUnique({ where: { key }, select: { value: true } });
  return row?.value ?? null;
}

async function setFlag(key: string, value: string): Promise<void> {
  await prisma.featureFlag.upsert({ where: { key }, create: { key, value }, update: { value } });
}

function parseJsonArray<T = any>(raw: string | null): T[] {
  if (!raw) return [];
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? (v as T[]) : [];
  } catch {
    return [];
  }
}

async function appendRunLog(entry: any): Promise<void> {
  try {
    const prev = parseJsonArray<any>(await getFlag(FLAG_WATTBUY_NIGHTLY_RUNLOG));
    const next = [entry, ...prev].slice(0, 5);
    await setFlag(FLAG_WATTBUY_NIGHTLY_RUNLOG, JSON.stringify(next));
  } catch {
    // ignore logging errors
  }
}

function mapUtilityIdToTdspCode(utilityId: string | null | undefined): string | null {
  const u = String(utilityId ?? "").trim();
  if (!u) return null;
  const upper = u.toUpperCase();
  if (["ONCOR", "CENTERPOINT", "AEP_NORTH", "AEP_CENTRAL", "TNMP"].includes(upper)) return upper;
  const byWattbuyId: Record<string, string> = {
    "44372": "ONCOR",
    "8901": "CENTERPOINT",
    "20404": "AEP_NORTH",
    "3278": "AEP_CENTRAL",
    "40051": "TNMP",
  };
  return byWattbuyId[u] ?? null;
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

function seedKeyToTdspSlug(seed: TerritorySeed["key"]): string {
  // These slugs match HouseAddress.tdspSlug and getTdspDeliveryRates().
  if (seed === "aep_c") return "aep_central";
  if (seed === "aep_n") return "aep_north";
  return seed; // oncor | centerpoint | tnmp
}

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

async function postNoBody(
  req: NextRequest,
  pathWithQuery: string,
  opts?: { timeoutMs?: number },
): Promise<{ ok: boolean; status: number; json: any | null; text: string | null }> {
  if (!ADMIN_TOKEN) {
    return { ok: false, status: 500, json: null, text: "ADMIN_TOKEN not configured" };
  }
  const url = new URL(pathWithQuery, req.nextUrl.origin);
  const timeoutMs = Math.max(5_000, Math.min(270_000, Number(opts?.timeoutMs ?? 120_000)));
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url.toString(), {
      method: "POST",
      headers: {
        "x-admin-token": ADMIN_TOKEN,
      },
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
    const guard = requireCronOrAdmin(req);
    if (guard) return guard as any;

    const url = new URL(req.url);
    const forceRaw = String(url.searchParams.get("force") ?? "").trim().toLowerCase();
    const force = forceRaw === "1" || forceRaw === "true" || forceRaw === "yes";
    const isCron = Boolean(req.headers.get("x-vercel-cron"));

    const sampleEmail =
      normalizeEmail(String((await getFlag(FLAG_SAMPLE_HOME_EMAIL)) ?? "").trim()) ?? DEFAULT_SAMPLE_HOME_EMAIL;

    // Time gating: Vercel Cron hits this endpoint frequently; we only do work at the configured Chicago time
    // unless force=1 is provided.
    if (!force) {
      const configured = (await getFlag(FLAG_WATTBUY_NIGHTLY_TIME)) ?? "01:30";
      const parsed = parseTimeHHMM(configured) ?? { hour: 1, minute: 30 };
      const nowChicago = chicagoNowParts();

      // Only run on exact HH:MM match (UI uses 5-minute step, and Vercel pings frequently).
      if (nowChicago.hour !== parsed.hour || nowChicago.minute !== parsed.minute) {
        return NextResponse.json({
          ok: true,
          skipped: true,
          reason: "not_scheduled_time",
          nowChicago,
          scheduledChicago: configured,
        });
      }

      const last = await getFlag(FLAG_WATTBUY_NIGHTLY_LAST_RUN_AT);
      if (last) {
        const lastDate = new Date(last);
        if (!Number.isNaN(lastDate.getTime())) {
          const lastChicago = chicagoNowParts(lastDate);
          if (lastChicago.ymd === nowChicago.ymd) {
            return NextResponse.json({
              ok: true,
              skipped: true,
              reason: "already_ran_today",
              nowChicago,
              scheduledChicago: configured,
              lastRunAt: last,
            });
          }
        }
      }
    }

    const startedAtMs = Date.now();
    const timeBudgetMs = 270_000; // leave buffer within maxDuration
    const deadlineMs = startedAtMs + timeBudgetMs;
    const shouldStop = () => Date.now() >= deadlineMs - 3_000;

    const only = String(url.searchParams.get("utility") ?? "").trim().toLowerCase() || null;
    const seeds = only
      ? TERRITORY_SEEDS.filter((s) => s.key === only || s.label.toLowerCase().includes(only))
      : TERRITORY_SEEDS.slice();

    const runs: any[] = [];

    // 1) Pull/parse offers for each territory seed and persist templates on PASS.
    for (const seed of seeds) {
      if (shouldStop()) break;

      const seedRuns: any[] = [];
      let startIndex = 0;
      let safetyLoops = 0;
      while (!shouldStop() && safetyLoops < 25) {
        safetyLoops++;
        const remaining = Math.max(0, deadlineMs - Date.now());
        const callBudget = Math.max(15_000, Math.min(120_000, remaining - 12_000));
        if (callBudget < 15_000) break;

        const r = await postJson(
          req,
          "/api/admin/wattbuy/offers-batch-efl-parse",
          {
            address: { state: seed.state, zip: seed.zip },
            mode: "STORE_TEMPLATES_ON_PASS",
            offerLimit: 500,
            startIndex,
            processLimit: 500,
            timeBudgetMs: callBudget,
            dryRun: false,
            forceReparseTemplates: false,
            runAll: true,
          },
          { timeoutMs: callBudget + 10_000 },
        );

        const ok = Boolean(r.ok && r.json && r.json.ok);
        const truncated = ok ? Boolean(r.json?.truncated) : false;
        const nextStartIndex =
          ok && typeof r.json?.nextStartIndex === "number" && Number.isFinite(r.json.nextStartIndex)
            ? (r.json.nextStartIndex as number)
            : null;

        seedRuns.push({
          ok: r.ok,
          status: r.status,
          startIndex,
          truncated,
          nextStartIndex,
          processedCount: ok ? (r.json?.processedCount ?? null) : null,
          scannedCount: ok ? (r.json?.scannedCount ?? null) : null,
          offerCount: ok ? (r.json?.offerCount ?? null) : null,
          error: !r.ok ? (r.json?.error ?? r.text ?? "request_failed") : null,
        });

        if (!ok) break;
        if (!truncated) break;
        if (nextStartIndex == null) break;
        if (nextStartIndex <= startIndex) break;
        startIndex = nextStartIndex;
        await new Promise((r) => setTimeout(r, 120));
      }

      runs.push({ type: "offers_batch_efl_parse", territory: seed, chunks: seedRuns });
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

    // 4) Synthetic compute validation: use ONLY the sample home's usage buckets, but apply TDSP rates
    // based on each plan's utilityId (NOT the sample home's address/tdsp).
    let syntheticValidation: any = null;
    if (!shouldStop() && sampleEmail) {
      try {
        const house = await (prisma as any).houseAddress.findFirst({
          where: { user: { email: sampleEmail }, archivedAt: null } as any,
          orderBy: { createdAt: "desc" },
          select: { id: true, esiid: true },
        });
        const homeId = house?.id ? String(house.id) : null;
        const esiid = house?.esiid ? String(house.esiid) : null;

        if (!homeId || !esiid) {
          syntheticValidation = { ok: false, error: "sample_home_missing_homeId_or_esiid", sampleEmail, homeId, esiid: Boolean(esiid) };
        } else {
          // Pull a small, representative set of templates per TDSP seed.
          const bySeed: Record<string, any[]> = {};
          const wantedUtilityIdsBySeed: Record<string, string[]> = {
            oncor: ["ONCOR", "44372"],
            centerpoint: ["CENTERPOINT", "8901"],
            tnmp: ["TNMP", "40051"],
            aep_c: ["AEP_CENTRAL", "3278"],
            aep_n: ["AEP_NORTH", "20404"],
          };

          for (const seed of seeds) {
            if (shouldStop()) break;
            const utilityIds = wantedUtilityIdsBySeed[seed.key] ?? [];
            const tpls =
              utilityIds.length > 0
                ? await (prisma as any).ratePlan.findMany({
                    where: {
                      state: "TX",
                      isUtilityTariff: false,
                      rateStructure: { not: null },
                      utilityId: { in: utilityIds },
                    } as any,
                    orderBy: { updatedAt: "desc" },
                    take: 10,
                    select: { id: true, utilityId: true, supplier: true, planName: true, rateStructure: true, requiredBucketKeys: true },
                  })
                : [];
            bySeed[seed.key] = Array.isArray(tpls) ? tpls : [];
          }

          // Union bucket keys across selected templates so we build usage buckets once.
          const unionKeys = new Set<string>(["kwh.m.all.total"]);
          const allTemplates: any[] = [];
          for (const seedKey of Object.keys(bySeed)) {
            for (const rp of bySeed[seedKey] ?? []) {
              allTemplates.push(rp);
              const keys = Array.isArray(rp?.requiredBucketKeys) ? (rp.requiredBucketKeys as string[]) : [];
              for (const k of keys) {
                const kk = String(k ?? "").trim();
                if (kk) unionKeys.add(kk);
              }
              if (rp?.rateStructure) {
                try {
                  const derived = derivePlanCalcRequirementsFromTemplate({ rateStructure: rp.rateStructure }).requiredBucketKeys ?? [];
                  for (const k of derived) {
                    const kk = String(k ?? "").trim();
                    if (kk) unionKeys.add(kk);
                  }
                } catch {
                  // ignore derivation failures here; estimateTrueCost will surface issues
                }
              }
            }
          }

          const usageWindowEnd = new Date();
          const usageCutoff = new Date(usageWindowEnd.getTime() - 365 * 24 * 60 * 60 * 1000);
          const bucketBuild = await buildUsageBucketsForEstimate({
            homeId,
            usageSource: "SMT",
            esiid,
            rawId: null,
            windowEnd: usageWindowEnd,
            cutoff: usageCutoff,
            requiredBucketKeys: Array.from(unionKeys),
            monthsCount: 12,
            maxStepDays: 2,
            stitchMode: "DAILY_OR_INTERVAL",
            computeMissing: true,
          });
          const annualKwh =
            typeof bucketBuild.annualKwh === "number" && Number.isFinite(bucketBuild.annualKwh) ? (bucketBuild.annualKwh as number) : null;

          const results: any[] = [];
          if (!annualKwh) {
            syntheticValidation = { ok: false, error: "missing_annual_kwh_from_usage_buckets", sampleEmail, homeId };
          } else {
            for (const rp of allTemplates) {
              if (shouldStop()) break;
              const rpId = String(rp?.id ?? "").trim();
              const utilityId = String(rp?.utilityId ?? "").trim() || null;
              const tdspCode = mapUtilityIdToTdspCode(utilityId);
              const tdspSlug = tdspCode ? tdspCode.toLowerCase() : null;
              const tdspRates = tdspSlug ? await getTdspDeliveryRates({ tdspSlug, asOf: new Date() }).catch(() => null) : null;
              const rateStructure = rp?.rateStructure ?? null;
              if (!rpId || !tdspRates || !rateStructure) {
                results.push({ ratePlanId: rpId || null, utilityId, tdspCode, status: "SKIP", reason: !tdspRates ? "missing_tdsp_rates" : "missing_rate_structure" });
                continue;
              }

              const est = estimateTrueCost({
                annualKwh,
                monthsCount: 12,
                rateStructure,
                usageBucketsByMonth: bucketBuild.usageBucketsByMonth,
                tdspRates: {
                  perKwhDeliveryChargeCents: Number(tdspRates.perKwhDeliveryChargeCents ?? 0) || 0,
                  monthlyCustomerChargeDollars: Number(tdspRates.monthlyCustomerChargeDollars ?? 0) || 0,
                  effectiveDate: tdspRates.effectiveDate ?? null,
                },
              });
              results.push({
                ratePlanId: rpId,
                utilityId,
                tdspCode,
                supplier: rp?.supplier ?? null,
                planName: rp?.planName ?? null,
                status: est?.status ?? "UNKNOWN",
                reason: est?.reason ?? null,
              });
            }

            const byStatus: Record<string, number> = {};
            for (const r of results) {
              const s = String(r?.status ?? "UNKNOWN");
              byStatus[s] = (byStatus[s] ?? 0) + 1;
            }
            syntheticValidation = { ok: true, sampleEmail, homeId, annualKwh, counts: { total: results.length, byStatus }, results: results.slice(0, 60) };
          }
        }
      } catch (e: any) {
        syntheticValidation = { ok: false, error: "synthetic_validation_failed", detail: e?.message ?? String(e) };
      }
    }

    const elapsedMs = Date.now() - startedAtMs;
    // Record a successful execution marker for time-gating (best-effort).
    if (isCron || force) {
      await setFlag(FLAG_WATTBUY_NIGHTLY_LAST_RUN_AT, new Date().toISOString());
    }
    await appendRunLog({
      at: new Date().toISOString(),
      forced: force,
      sampleEmail,
      elapsedMs,
      seedsAttempted: seeds.length,
      processOpenOk: Boolean(processOpenResult?.ok),
      processQuarantineOk: Boolean(processQuarantineResult?.ok),
      syntheticValidationOk: Boolean(syntheticValidation?.ok),
      syntheticValidationCounts: syntheticValidation?.counts ?? null,
    });
    return NextResponse.json({
      ok: true,
      startedAt: new Date(startedAtMs).toISOString(),
      elapsedMs,
      seedsAttempted: seeds.length,
      runs,
      processOpenResult,
      processQuarantineResult,
      syntheticValidation,
      stoppedEarly: shouldStop(),
      forced: force,
    });
  } catch (e: any) {
    return jsonError(500, "Internal error running nightly template job", e?.message ?? String(e));
  }
}

