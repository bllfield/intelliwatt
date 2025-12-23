import { NextRequest, NextResponse } from "next/server";

import { prisma } from "@/lib/db";
import { requireAdmin } from "@/lib/auth/admin";
import { getLatestPlanPipelineJob } from "@/lib/plan-engine/planPipelineJob";
import { runPlanPipelineForHome } from "@/lib/plan-engine/runPlanPipelineForHome";
import { normalizeEmail } from "@/lib/utils/email";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

function toInt(v: string | null, fallback: number): number {
  const n = Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : fallback;
}

async function resolveHomeIdFromEmail(emailRaw: string): Promise<string | null> {
  const email = normalizeEmail(emailRaw);
  if (!email) return null;
  const user = await prisma.user.findUnique({ where: { email }, select: { id: true } });
  if (!user) return null;
  const house =
    (await prisma.houseAddress.findFirst({
      where: { userId: user.id, archivedAt: null, isPrimary: true } as any,
      orderBy: { createdAt: "desc" },
      select: { id: true },
    })) ??
    (await prisma.houseAddress.findFirst({
      where: { userId: user.id, archivedAt: null } as any,
      orderBy: { createdAt: "desc" },
      select: { id: true },
    }));
  return house?.id ?? null;
}

export async function GET(req: NextRequest) {
  const gate = requireAdmin(req);
  if (!gate.ok) return NextResponse.json(gate.body, { status: gate.status });

  const url = new URL(req.url);
  const homeIdFromQuery = String(url.searchParams.get("homeId") ?? "").trim();
  const email = String(url.searchParams.get("email") ?? "").trim();

  const homeId = homeIdFromQuery || (email ? await resolveHomeIdFromEmail(email) : null);
  if (!homeId) return NextResponse.json({ ok: false, error: "missing_homeId_or_email" }, { status: 400 });

  const latest = await getLatestPlanPipelineJob(homeId);
  return NextResponse.json({ ok: true, homeId, latestJob: latest }, { status: 200 });
}

export async function POST(req: NextRequest) {
  const gate = requireAdmin(req);
  if (!gate.ok) return NextResponse.json(gate.body, { status: gate.status });

  const url = new URL(req.url);
  const homeIdFromQuery = String(url.searchParams.get("homeId") ?? "").trim();
  const email = String(url.searchParams.get("email") ?? "").trim();
  const reason = String(url.searchParams.get("reason") ?? "admin_manual").trim() || "admin_manual";

  const timeBudgetMs = clamp(toInt(url.searchParams.get("timeBudgetMs"), 25_000), 1500, 25_000);
  const maxTemplateOffers = clamp(toInt(url.searchParams.get("maxTemplateOffers"), 6), 0, 10);
  const maxEstimatePlans = clamp(toInt(url.searchParams.get("maxEstimatePlans"), 50), 0, 50);
  const fallbackCooldownMs = clamp(toInt(url.searchParams.get("fallbackCooldownMs"), 15_000), 5_000, 24 * 60 * 60 * 1000);

  const homeId = homeIdFromQuery || (email ? await resolveHomeIdFromEmail(email) : null);
  if (!homeId) return NextResponse.json({ ok: false, error: "missing_homeId_or_email" }, { status: 400 });

  const before = await getLatestPlanPipelineJob(homeId);
  const result = await runPlanPipelineForHome({
    homeId,
    reason,
    timeBudgetMs,
    maxTemplateOffers,
    maxEstimatePlans,
    monthlyCadenceDays: 30,
    proactiveCooldownMs: 60_000,
    fallbackCooldownMs,
  });
  const after = await getLatestPlanPipelineJob(homeId);

  return NextResponse.json({ ok: true, homeId, before, result, after }, { status: 200 });
}


