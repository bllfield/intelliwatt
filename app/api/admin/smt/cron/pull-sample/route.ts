import { NextRequest, NextResponse } from "next/server";

import { requireVercelCron } from "@/lib/auth/cron";
import { prisma } from "@/lib/db";
import { normalizeEmail } from "@/lib/utils/email";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const ADMIN_TOKEN = process.env.ADMIN_TOKEN;
const DEFAULT_SAMPLE_HOME_EMAIL = (process.env.SAMPLE_HOME_EMAIL ?? "bllfield32@gmail.com").trim().toLowerCase();

const FLAG_SMT_SAMPLE_TIME = "cron:smt_sample_pull:time_chicago";
const FLAG_SMT_SAMPLE_LAST_RUN_AT = "cron:smt_sample_pull:last_run_at";
const FLAG_SMT_SAMPLE_RUNLOG = "cron:smt_sample_pull:runlog_json";
const FLAG_SAMPLE_HOME_EMAIL = "cron:sample_home:email";

function jsonError(status: number, error: string, details?: unknown) {
  return NextResponse.json({ ok: false, error, ...(details ? { details } : {}) }, { status });
}

function requireCronOrAdmin(req: NextRequest): Response | null {
  if (req.headers.get("x-vercel-cron")) {
    return requireVercelCron(req);
  }
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
    const prev = parseJsonArray<any>(await getFlag(FLAG_SMT_SAMPLE_RUNLOG));
    const next = [entry, ...prev].slice(0, 5);
    await setFlag(FLAG_SMT_SAMPLE_RUNLOG, JSON.stringify(next));
  } catch {
    // ignore logging errors
  }
}

function daysBetween(a: Date, b: Date): number {
  const ms = Math.abs(b.getTime() - a.getTime());
  return ms / (1000 * 60 * 60 * 24);
}

async function resolveHomeIdFromEmail(emailRaw: string): Promise<string | null> {
  const email = normalizeEmail(emailRaw);
  if (!email) return null;
  const user = await prisma.user.findUnique({ where: { email }, select: { id: true } });
  if (!user) return null;
  const house =
    (await (prisma as any).houseAddress.findFirst({
      where: { userId: user.id, archivedAt: null, isPrimary: true } as any,
      orderBy: { createdAt: "desc" },
      select: { id: true } as any,
    })) ??
    (await (prisma as any).houseAddress.findFirst({
      where: { userId: user.id, archivedAt: null } as any,
      orderBy: { createdAt: "desc" },
      select: { id: true } as any,
    }));
  return house?.id ? String(house.id) : null;
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
    if (!sampleEmail) return jsonError(400, "SAMPLE_HOME_EMAIL is empty");

    // Time gating: run best-effort every ~30 days at configured Chicago time (unless force=1).
    if (!force) {
      const configured = (await getFlag(FLAG_SMT_SAMPLE_TIME)) ?? "02:00";
      const parsed = parseTimeHHMM(configured) ?? { hour: 2, minute: 0 };
      const nowChicago = chicagoNowParts();

      if (nowChicago.hour !== parsed.hour || nowChicago.minute !== parsed.minute) {
        return NextResponse.json({
          ok: true,
          skipped: true,
          reason: "not_scheduled_time",
          nowChicago,
          scheduledChicago: configured,
        });
      }

      const last = await getFlag(FLAG_SMT_SAMPLE_LAST_RUN_AT);
      if (last) {
        const lastDate = new Date(last);
        if (!Number.isNaN(lastDate.getTime())) {
          const d = daysBetween(lastDate, new Date());
          if (d < 30) {
            return NextResponse.json({
              ok: true,
              skipped: true,
              reason: "cooldown_active",
              cooldownDaysRemaining: Math.max(0, Math.ceil(30 - d)),
              nowChicago,
              scheduledChicago: configured,
              lastRunAt: last,
            });
          }
        }
      }
    }

    const homeId = await resolveHomeIdFromEmail(sampleEmail);
    if (!homeId) return jsonError(404, "sample_home_not_found", { email: sampleEmail });

    // (1) Trigger SMT pull via droplet webhook.
    // This writes new intervals; normalization is handled downstream by existing pipelines.
    const smtPull = await postJson(
      req,
      "/api/admin/smt/pull",
      {
        homeId,
        reason: "cron_sample_home_monthly",
        forceRepost: true,
      },
      { timeoutMs: 180_000 },
    );

    // (2) Run plan pipeline for the sample home to refresh usage buckets + materialized estimates.
    const qp = new URLSearchParams({
      homeId,
      reason: "cron_sample_home_monthly",
      timeBudgetMs: "25000",
      maxTemplateOffers: "10",
      maxEstimatePlans: "200",
    });
    const pipeline = await postNoBody(req, `/api/admin/plans/pipeline?${qp.toString()}`, { timeoutMs: 60_000 });

    // Record execution marker for time-gating (best-effort).
    if (isCron || force) {
      await setFlag(FLAG_SMT_SAMPLE_LAST_RUN_AT, new Date().toISOString());
    }

    await appendRunLog({
      at: new Date().toISOString(),
      forced: force,
      sampleEmail,
      homeId,
      smtPull: { ok: smtPull.ok, status: smtPull.status },
      pipeline: { ok: pipeline.ok, status: pipeline.status },
    });

    return NextResponse.json({
      ok: true,
      sampleEmail,
      homeId,
      smtPull: { ok: smtPull.ok, status: smtPull.status, body: smtPull.json ?? { raw: smtPull.text } },
      pipeline: { ok: pipeline.ok, status: pipeline.status, body: pipeline.json ?? { raw: pipeline.text } },
      forced: force,
    });
  } catch (e: any) {
    return jsonError(500, "Internal error running sample SMT pull cron", e?.message ?? String(e));
  }
}

