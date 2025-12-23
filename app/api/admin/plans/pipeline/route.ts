import { NextRequest, NextResponse } from "next/server";

import { prisma } from "@/lib/db";
import { requireAdmin } from "@/lib/auth/admin";
import { getLatestPlanPipelineJob } from "@/lib/plan-engine/planPipelineJob";
import { runPlanPipelineForHome } from "@/lib/plan-engine/runPlanPipelineForHome";
import { normalizeEmail } from "@/lib/utils/email";
import { wattbuy } from "@/lib/wattbuy";
import { normalizeOffers } from "@/lib/wattbuy/normalize";

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
  const debug = String(url.searchParams.get("debug") ?? "").trim() === "1";

  const homeId = homeIdFromQuery || (email ? await resolveHomeIdFromEmail(email) : null);
  if (!homeId) return NextResponse.json({ ok: false, error: "missing_homeId_or_email" }, { status: 400 });

  let debugInfo: any = null;
  if (debug) {
    try {
      const house = await prisma.houseAddress.findUnique({
        where: { id: homeId } as any,
        select: {
          id: true,
          addressLine1: true,
          addressCity: true,
          addressState: true,
          addressZip5: true,
        },
      });
      if (house?.addressLine1 && house.addressCity && house.addressState && house.addressZip5) {
        const raw = await wattbuy.offers({
          address: house.addressLine1,
          city: house.addressCity,
          state: house.addressState,
          zip: house.addressZip5,
          isRenter: false,
        });
        const normalized = normalizeOffers(raw ?? {});
        const offers = Array.isArray((normalized as any)?.offers) ? ((normalized as any).offers as any[]) : [];
        const offerIds = offers.map((o) => String(o?.offer_id ?? "").trim()).filter(Boolean);

        const mapCount = await (prisma as any).offerIdRatePlanMap.count({
          where: { offerId: { in: offerIds }, ratePlanId: { not: null } },
        });
        const ratePlanCount = await (prisma as any).ratePlan.count({
          where: { offerId: { in: offerIds } },
        });

        debugInfo = {
          offersTotal: offers.length,
          sampleOfferIds: offerIds.slice(0, 8),
          offerIdRatePlanMapCount: mapCount,
          ratePlanOfferIdMatchCount: ratePlanCount,
        };
      } else {
        debugInfo = { error: "missing_house_address_fields_for_wattbuy_call" };
      }
    } catch (e: any) {
      debugInfo = { error: "debug_failed", detail: e?.message ?? String(e) };
    }
  }

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

  return NextResponse.json({ ok: true, homeId, ...(debugInfo ? { debug: debugInfo } : {}), before, result, after }, { status: 200 });
}


