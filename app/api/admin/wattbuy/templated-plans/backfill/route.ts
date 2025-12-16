import { NextRequest, NextResponse } from "next/server";

import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

const ADMIN_TOKEN = process.env.ADMIN_TOKEN;

function jsonError(status: number, error: string, details?: unknown) {
  return NextResponse.json(
    { ok: false, error, ...(details ? { details } : {}) },
    { status },
  );
}

function inferTermMonths(planName: string | null | undefined): number | null {
  if (!planName) return null;
  const s = String(planName);

  // Strongest: explicit "mo/month" tokens
  const m1 = s.match(/\b(\d{1,2})\s*(?:mo|mos|month|months)\b/i);
  if (m1) {
    const n = Number(m1[1]);
    if (Number.isFinite(n) && n >= 1 && n <= 60) return n;
  }

  // Next: trailing number (e.g., "Solarize 15")
  const m2 = s.match(/\b(\d{1,2})\b\s*$/);
  if (m2) {
    const n = Number(m2[1]);
    if (Number.isFinite(n) && n >= 1 && n <= 60) return n;
  }

  // Next: "-12" suffix pattern (avoid big IDs by limiting to 1-2 digits)
  const m3 = s.match(/-(\d{1,2})\b/);
  if (m3) {
    const n = Number(m3[1]);
    if (Number.isFinite(n) && n >= 1 && n <= 60) return n;
  }

  return null;
}

function toNum(x: any): number | null {
  const n = Number(x);
  return Number.isFinite(n) ? n : null;
}

function computeAvgCentsPerKwhFromRateStructure(
  rateStructure: any,
  usageKwh: number,
): number | null {
  if (!rateStructure || typeof rateStructure !== "object") return null;
  if (!Number.isFinite(usageKwh) || usageKwh <= 0) return null;

  const type = String(rateStructure.type ?? "").toUpperCase();
  const baseFee = toNum(rateStructure.baseMonthlyFeeCents) ?? 0;

  const usageTiers: any[] | null = Array.isArray(rateStructure.usageTiers)
    ? rateStructure.usageTiers
    : null;

  const computeTieredEnergyCents = (): number | null => {
    if (!usageTiers || usageTiers.length === 0) return null;
    const tiers = usageTiers
      .map((t) => ({
        minKWh: toNum((t as any).minKWh ?? (t as any).minKwh ?? 0) ?? 0,
        maxKWh: toNum((t as any).maxKWh ?? (t as any).maxKwh ?? null),
        centsPerKWh: toNum(
          (t as any).centsPerKWh ??
            (t as any).priceCents ??
            (t as any).rateCentsPerKwh,
        ),
      }))
      .filter((t) => Number.isFinite(t.minKWh) && typeof t.centsPerKWh === "number")
      .sort((a, b) => a.minKWh - b.minKWh);

    if (tiers.length === 0) return null;

    let remaining = usageKwh;
    let energyCents = 0;

    for (let i = 0; i < tiers.length && remaining > 0; i++) {
      const t = tiers[i];
      const nextMin = tiers[i + 1]?.minKWh ?? null;
      const upper =
        typeof t.maxKWh === "number"
          ? t.maxKWh
          : typeof nextMin === "number"
            ? nextMin
            : null;
      const span = upper != null ? Math.max(0, upper - t.minKWh) : remaining;
      const kwhInTier = Math.min(remaining, span);
      if (kwhInTier <= 0) continue;
      energyCents += kwhInTier * (t.centsPerKWh as number);
      remaining -= kwhInTier;
    }

    if (remaining > 0) {
      const last = tiers[tiers.length - 1];
      if (typeof last?.centsPerKWh === "number") {
        energyCents += remaining * last.centsPerKWh;
      }
    }

    return energyCents;
  };

  const computeFlatEnergyCents = (centsPerKwh: number | null): number | null => {
    if (typeof centsPerKwh !== "number") return null;
    return usageKwh * centsPerKwh;
  };

  let energyCents: number | null = null;
  if (usageTiers && usageTiers.length > 0) {
    energyCents = computeTieredEnergyCents();
  }

  if (energyCents == null) {
    if (type === "FIXED") {
      energyCents = computeFlatEnergyCents(toNum(rateStructure.energyRateCents));
    } else if (type === "VARIABLE") {
      energyCents = computeFlatEnergyCents(toNum(rateStructure.currentBillEnergyRateCents));
    } else {
      // TIME_OF_USE requires usage distribution; we don't guess.
      return null;
    }
  }

  const credits = (rateStructure as any).billCredits;
  let billCreditCents = 0;
  if (credits && credits.hasBillCredit && Array.isArray(credits.rules)) {
    for (const r of credits.rules) {
      const credit = toNum((r as any).creditAmountCents);
      const min = toNum((r as any).minUsageKWh) ?? 0;
      const max = toNum((r as any).maxUsageKWh ?? null);
      if (typeof credit !== "number" || credit <= 0) continue;
      const okMin = usageKwh >= min;
      const okMax = max == null ? true : usageKwh <= max;
      if (okMin && okMax) billCreditCents += credit;
    }
  }

  const totalCents = (energyCents ?? 0) + baseFee - billCreditCents;
  return totalCents / usageKwh;
}

export async function POST(req: NextRequest) {
  try {
    if (!ADMIN_TOKEN) return jsonError(500, "ADMIN_TOKEN is not configured");
    const headerToken = req.headers.get("x-admin-token");
    if (!headerToken || headerToken !== ADMIN_TOKEN) {
      return jsonError(401, "Unauthorized (invalid admin token)");
    }

    const limitRaw = Number(req.nextUrl.searchParams.get("limit") ?? "200");
    const limit = Math.max(1, Math.min(1000, Number.isFinite(limitRaw) ? limitRaw : 200));
    const q = (req.nextUrl.searchParams.get("q") ?? "").trim();
    const dryRun = (req.nextUrl.searchParams.get("dryRun") ?? "") === "1";

    const where: any = {
      rateStructure: { not: null },
      eflRequiresManualReview: false,
      isUtilityTariff: false,
      OR: [
        { termMonths: null },
        { rate500: null },
        { rate1000: null },
        { rate2000: null },
      ],
      ...(q
        ? {
            AND: [
              {
                OR: [
                  { supplier: { contains: q, mode: "insensitive" } },
                  { planName: { contains: q, mode: "insensitive" } },
                  { eflVersionCode: { contains: q, mode: "insensitive" } },
                  { repPuctCertificate: { contains: q, mode: "insensitive" } },
                  { eflPdfSha256: { contains: q, mode: "insensitive" } },
                ],
              },
            ],
          }
        : {}),
    };

    const plans = await (prisma as any).ratePlan.findMany({
      where,
      select: {
        id: true,
        planName: true,
        termMonths: true,
        rate500: true,
        rate1000: true,
        rate2000: true,
        rateStructure: true,
      },
      orderBy: [{ updatedAt: "desc" }],
      take: limit,
    });

    let updated = 0;
    let skipped = 0;
    const reasons: Record<string, number> = {};

    for (const p of plans as any[]) {
      const computedTerm =
        typeof p.termMonths === "number" ? null : inferTermMonths(p.planName);
      const computed500 =
        typeof p.rate500 === "number"
          ? null
          : computeAvgCentsPerKwhFromRateStructure(p.rateStructure, 500);
      const computed1000 =
        typeof p.rate1000 === "number"
          ? null
          : computeAvgCentsPerKwhFromRateStructure(p.rateStructure, 1000);
      const computed2000 =
        typeof p.rate2000 === "number"
          ? null
          : computeAvgCentsPerKwhFromRateStructure(p.rateStructure, 2000);

      const data: any = {};
      if (typeof computedTerm === "number") data.termMonths = computedTerm;
      if (typeof computed500 === "number") data.rate500 = computed500;
      if (typeof computed1000 === "number") data.rate1000 = computed1000;
      if (typeof computed2000 === "number") data.rate2000 = computed2000;

      if (Object.keys(data).length === 0) {
        skipped += 1;
        const kind =
          String(p?.rateStructure?.type ?? "").toUpperCase() === "TIME_OF_USE"
            ? "SKIP_TOU_NOT_COMPUTABLE"
            : "SKIP_NO_DERIVABLE_FIELDS";
        reasons[kind] = (reasons[kind] ?? 0) + 1;
        continue;
      }

      if (!dryRun) {
        await (prisma as any).ratePlan.update({
          where: { id: p.id },
          data,
        });
      }
      updated += 1;
    }

    return NextResponse.json({
      ok: true,
      dryRun,
      scanned: plans.length,
      updated,
      skipped,
      reasons,
    });
  } catch (err: any) {
    // eslint-disable-next-line no-console
    console.error("[ADMIN_WATTBUY_TEMPLATED_PLANS_BACKFILL] error:", err);
    return jsonError(500, "Internal error while backfilling templated plans", err?.message);
  }
}


