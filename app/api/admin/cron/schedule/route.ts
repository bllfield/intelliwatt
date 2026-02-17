import { NextRequest, NextResponse } from "next/server";

import { prisma } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ADMIN_TOKEN = process.env.ADMIN_TOKEN;
const DEFAULT_SAMPLE_HOME_EMAIL = (process.env.SAMPLE_HOME_EMAIL ?? "bllfield32@gmail.com").trim().toLowerCase();

const FLAG_WATTBUY_NIGHTLY_TIME = "cron:wattbuy_nightly:time_chicago";
const FLAG_WATTBUY_NIGHTLY_LAST_RUN_AT = "cron:wattbuy_nightly:last_run_at";
const FLAG_WATTBUY_NIGHTLY_RUNLOG = "cron:wattbuy_nightly:runlog_json";
const FLAG_SMT_SAMPLE_TIME = "cron:smt_sample_pull:time_chicago";
const FLAG_SMT_SAMPLE_LAST_RUN_AT = "cron:smt_sample_pull:last_run_at";
const FLAG_SMT_SAMPLE_RUNLOG = "cron:smt_sample_pull:runlog_json";
const FLAG_SAMPLE_HOME_EMAIL = "cron:sample_home:email";

function jsonError(status: number, error: string, details?: unknown) {
  return NextResponse.json({ ok: false, error, ...(details ? { details } : {}) }, { status });
}

function requireAdmin(req: NextRequest): Response | null {
  const headerToken = req.headers.get("x-admin-token");
  if (!ADMIN_TOKEN || !headerToken || headerToken !== ADMIN_TOKEN) return jsonError(401, "Unauthorized");
  return null;
}

function isValidTimeHHMM(v: unknown): v is string {
  if (typeof v !== "string") return false;
  const m = v.trim().match(/^([01]\d|2[0-3]):([0-5]\d)$/);
  return Boolean(m);
}

function normalizeEmailLoose(v: unknown): string | null {
  const s = String(v ?? "")
    .trim()
    .toLowerCase();
  if (!s) return null;
  // Minimal validation: must contain one @ and at least one dot after it.
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(s)) return null;
  return s;
}

async function getFlag(key: string): Promise<string | null> {
  const row = await prisma.featureFlag.findUnique({ where: { key }, select: { value: true } });
  return row?.value ?? null;
}

async function setFlag(key: string, value: string): Promise<void> {
  await prisma.featureFlag.upsert({
    where: { key },
    create: { key, value },
    update: { value },
  });
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

export async function GET(req: NextRequest) {
  try {
    const guard = requireAdmin(req);
    if (guard) return guard as any;

    const [nightlyTime, nightlyLast, nightlyRunlogRaw, smtTime, smtLast, smtRunlogRaw, sampleEmailRaw] = await Promise.all([
      getFlag(FLAG_WATTBUY_NIGHTLY_TIME),
      getFlag(FLAG_WATTBUY_NIGHTLY_LAST_RUN_AT),
      getFlag(FLAG_WATTBUY_NIGHTLY_RUNLOG),
      getFlag(FLAG_SMT_SAMPLE_TIME),
      getFlag(FLAG_SMT_SAMPLE_LAST_RUN_AT),
      getFlag(FLAG_SMT_SAMPLE_RUNLOG),
      getFlag(FLAG_SAMPLE_HOME_EMAIL),
    ]);

    const sampleHomeEmail = normalizeEmailLoose(sampleEmailRaw) ?? DEFAULT_SAMPLE_HOME_EMAIL;

    return NextResponse.json({
      ok: true,
      schedules: {
        wattbuyNightly: {
          timeChicago: nightlyTime ?? "01:30",
          lastRunAt: nightlyLast,
          runLog: parseJsonArray<any>(nightlyRunlogRaw).slice(0, 5),
          timeFlagKey: FLAG_WATTBUY_NIGHTLY_TIME,
          lastRunFlagKey: FLAG_WATTBUY_NIGHTLY_LAST_RUN_AT,
        },
        smtSamplePull: {
          timeChicago: smtTime ?? "02:00",
          lastRunAt: smtLast,
          cadenceDays: 30,
          runLog: parseJsonArray<any>(smtRunlogRaw).slice(0, 5),
          timeFlagKey: FLAG_SMT_SAMPLE_TIME,
          lastRunFlagKey: FLAG_SMT_SAMPLE_LAST_RUN_AT,
        },
      },
      sampleHome: {
        email: sampleHomeEmail,
        emailFlagKey: FLAG_SAMPLE_HOME_EMAIL,
      },
      notes: [
        "Times are interpreted in America/Chicago.",
        "Vercel cron hits the endpoints frequently; the endpoints only execute when 'now' matches the configured time (unless force=1).",
      ],
    });
  } catch (e: any) {
    return jsonError(500, "Internal error reading cron schedule", e?.message ?? String(e));
  }
}

export async function POST(req: NextRequest) {
  try {
    const guard = requireAdmin(req);
    if (guard) return guard as any;

    const body = await req.json().catch(() => null);
    const nextNightly = body?.wattbuyNightly?.timeChicago;
    const nextSmt = body?.smtSamplePull?.timeChicago;
    const nextSampleEmail = body?.sampleHome?.email;

    const writes: Array<Promise<void>> = [];

    if (nextNightly !== undefined) {
      if (!isValidTimeHHMM(nextNightly)) return jsonError(400, "invalid_time", { field: "wattbuyNightly.timeChicago" });
      writes.push(setFlag(FLAG_WATTBUY_NIGHTLY_TIME, nextNightly.trim()));
    }
    if (nextSmt !== undefined) {
      if (!isValidTimeHHMM(nextSmt)) return jsonError(400, "invalid_time", { field: "smtSamplePull.timeChicago" });
      writes.push(setFlag(FLAG_SMT_SAMPLE_TIME, nextSmt.trim()));
    }
    if (nextSampleEmail !== undefined) {
      const norm = normalizeEmailLoose(nextSampleEmail);
      if (!norm) return jsonError(400, "invalid_email", { field: "sampleHome.email" });
      writes.push(setFlag(FLAG_SAMPLE_HOME_EMAIL, norm));
    }

    await Promise.all(writes);
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return jsonError(500, "Internal error updating cron schedule", e?.message ?? String(e));
  }
}

