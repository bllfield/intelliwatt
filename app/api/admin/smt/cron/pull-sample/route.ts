import { NextRequest, NextResponse } from "next/server";

import { requireVercelCron } from "@/lib/auth/cron";
import { prisma } from "@/lib/db";
import { normalizeEmail } from "@/lib/utils/email";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const ADMIN_TOKEN = process.env.ADMIN_TOKEN;
const SAMPLE_HOME_EMAIL = (process.env.SAMPLE_HOME_EMAIL ?? "bllfield32@gmail.com").trim().toLowerCase();

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
    if (!SAMPLE_HOME_EMAIL) return jsonError(400, "SAMPLE_HOME_EMAIL is empty");

    const homeId = await resolveHomeIdFromEmail(SAMPLE_HOME_EMAIL);
    if (!homeId) return jsonError(404, "sample_home_not_found", { email: SAMPLE_HOME_EMAIL });

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

    return NextResponse.json({
      ok: true,
      sampleEmail: SAMPLE_HOME_EMAIL,
      homeId,
      smtPull: { ok: smtPull.ok, status: smtPull.status, body: smtPull.json ?? { raw: smtPull.text } },
      pipeline: { ok: pipeline.ok, status: pipeline.status, body: pipeline.json ?? { raw: pipeline.text } },
    });
  } catch (e: any) {
    return jsonError(500, "Internal error running sample SMT pull cron", e?.message ?? String(e));
  }
}

