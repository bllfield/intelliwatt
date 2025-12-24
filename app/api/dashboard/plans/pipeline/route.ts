import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";

import { prisma } from "@/lib/db";
import { normalizeEmail } from "@/lib/utils/email";
import { runPlanPipelineForHome } from "@/lib/plan-engine/runPlanPipelineForHome";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Pipeline can do usage-bucket loads + cache writes; allow enough time on Vercel.
export const maxDuration = 300;

function parseBool(v: string | null, fallback: boolean): boolean {
  if (v == null) return fallback;
  const s = v.trim().toLowerCase();
  if (!s) return fallback;
  if (["1", "true", "yes", "y", "on"].includes(s)) return true;
  if (["0", "false", "no", "n", "off"].includes(s)) return false;
  return fallback;
}

function toInt(v: string | null, fallback: number): number {
  const n = Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : fallback;
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

export async function POST(req: NextRequest) {
  const url = new URL(req.url);
  const reason = (url.searchParams.get("reason") ?? "plans_fallback").trim() || "plans_fallback";
  const timeBudgetMs = clamp(toInt(url.searchParams.get("timeBudgetMs"), 12_000), 1500, 25_000);
  const maxTemplateOffers = clamp(toInt(url.searchParams.get("maxTemplateOffers"), 6), 0, 10);
  const maxEstimatePlans = clamp(toInt(url.searchParams.get("maxEstimatePlans"), 50), 0, 200);
  const isRenter = parseBool(url.searchParams.get("isRenter"), false);
  const proactiveCooldownMs = clamp(toInt(url.searchParams.get("proactiveCooldownMs"), 5 * 60 * 1000), 60_000, 24 * 60 * 60 * 1000);
  // Plans page needs to be able to re-kick the pipeline quickly if a first run times out / cold-starts.
  const fallbackCooldownMs = clamp(toInt(url.searchParams.get("fallbackCooldownMs"), 15 * 1000), 5_000, 24 * 60 * 60 * 1000);

  try {
    const cookieStore = cookies();
    const sessionEmail = cookieStore.get("intelliwatt_user")?.value ?? null;
    if (!sessionEmail) return NextResponse.json({ ok: false, error: "not_authenticated" }, { status: 401 });

    const userEmail = normalizeEmail(sessionEmail);
    const user = await prisma.user.findUnique({ where: { email: userEmail }, select: { id: true } });
    if (!user) return NextResponse.json({ ok: false, error: "user_not_found" }, { status: 404 });

    // Primary home.
    let house = await prisma.houseAddress.findFirst({
      where: { userId: user.id, archivedAt: null, isPrimary: true } as any,
      orderBy: { createdAt: "desc" },
      select: { id: true, addressLine1: true, addressCity: true, addressState: true, addressZip5: true, esiid: true, tdspSlug: true, utilityName: true },
    });
    if (!house) {
      house = await prisma.houseAddress.findFirst({
        where: { userId: user.id, archivedAt: null } as any,
        orderBy: { createdAt: "desc" },
        select: { id: true, addressLine1: true, addressCity: true, addressState: true, addressZip5: true, esiid: true, tdspSlug: true, utilityName: true },
      });
    }
    if (!house) return NextResponse.json({ ok: false, error: "no_home" }, { status: 400 });
    const result = await runPlanPipelineForHome({
      homeId: house.id,
      reason,
      isRenter,
      timeBudgetMs,
      maxTemplateOffers,
      maxEstimatePlans,
      monthlyCadenceDays: 30,
      proactiveCooldownMs,
      fallbackCooldownMs,
    });

    return NextResponse.json(result, { status: 200 });
  } catch (e: any) {
    const msg = (e?.message ?? String(e)) as string;
    console.error("[dashboard_plans_pipeline] fatal error", { message: msg });
    // Fail-soft: this endpoint is triggered by customer dashboard flows; do not return 500.
    return NextResponse.json({ ok: false, error: msg }, { status: 200 });
  }
}


