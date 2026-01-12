import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";

import { prisma } from "@/lib/db";
import { normalizeEmail } from "@/lib/utils/email";
import { runPlanPipelineForHome } from "@/lib/plan-engine/runPlanPipelineForHome";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Pipeline can do usage-bucket loads + cache writes; allow enough time on Vercel.
export const maxDuration = 300;

function toErrorMessage(e: any): string {
  // Keep empty string, stringify non-string primitives (0/false), and fall back to String(e).
  if (e && typeof e === "object" && "message" in e) {
    const m = (e as any).message;
    if (typeof m === "string") return m;
    if (m != null) return String(m);
  }
  return String(e);
}

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
  // IMPORTANT: This endpoint is called from the browser and must return reliably.
  // We've seen gateway timeouts around ~25s in production; keep a conservative cap and rely on multiple short runs.
  const timeBudgetMs = clamp(toInt(url.searchParams.get("timeBudgetMs"), 12_000), 1500, 12_000);
  const maxTemplateOffers = clamp(toInt(url.searchParams.get("maxTemplateOffers"), 6), 0, 10);
  const maxEstimatePlans = clamp(toInt(url.searchParams.get("maxEstimatePlans"), 50), 0, 200);
  // Renter is a persisted home attribute (address-level), not a plans-page filter.
  // We intentionally do NOT trust a query param here.
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
    let house: any = await (prisma as any).houseAddress.findFirst({
      where: { userId: user.id, archivedAt: null, isPrimary: true } as any,
      orderBy: { createdAt: "desc" },
      // NOTE: Prisma client types may lag behind schema deploys; keep select typed as any.
      select: { id: true, isRenter: true, addressLine1: true, addressCity: true, addressState: true, addressZip5: true, esiid: true, tdspSlug: true, utilityName: true } as any,
    });
    if (!house) {
      house = await (prisma as any).houseAddress.findFirst({
        where: { userId: user.id, archivedAt: null } as any,
        orderBy: { createdAt: "desc" },
        select: { id: true, isRenter: true, addressLine1: true, addressCity: true, addressState: true, addressZip5: true, esiid: true, tdspSlug: true, utilityName: true } as any,
      });
    }
    if (!house) return NextResponse.json({ ok: false, error: "no_home" }, { status: 400 });
    const isRenter = Boolean((house as any)?.isRenter === true);
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
    const msg = toErrorMessage(e);
    console.error("[dashboard_plans_pipeline] fatal error", { message: msg });
    // Fail-soft: this endpoint is triggered by customer dashboard flows; do not return 500.
    return NextResponse.json({ ok: false, error: msg }, { status: 200 });
  }
}


