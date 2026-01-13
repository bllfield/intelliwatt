import { NextRequest, NextResponse } from "next/server";
import { getCurrentPlanPrisma } from "@/lib/prismaCurrentPlan";

export const dynamic = "force-dynamic";

function jsonError(status: number, error: string, extra?: Record<string, any>) {
  return NextResponse.json({ ok: false, error, ...(extra ?? {}) }, { status });
}

function normalizeKey(s: any): string {
  return String(s ?? "").trim().toUpperCase();
}

export async function POST(req: NextRequest) {
  try {
    const adminToken = process.env.ADMIN_TOKEN;
    if (!adminToken) return jsonError(500, "ADMIN_TOKEN not configured");

    const headerToken = req.headers.get("x-admin-token");
    if (!headerToken || headerToken !== adminToken) return jsonError(401, "Unauthorized");

    if (!process.env.CURRENT_PLAN_DATABASE_URL) {
      return jsonError(500, "CURRENT_PLAN_DATABASE_URL is not configured");
    }

    const url = new URL(req.url);
    const limitRaw = Number(url.searchParams.get("limit") || "500");
    const limit = Math.max(1, Math.min(5000, Number.isFinite(limitRaw) ? limitRaw : 500));
    const dryRun = (url.searchParams.get("dryRun") || "").trim() === "1";

    const currentPlanPrisma: any = getCurrentPlanPrisma();

    // DB identity (safe, no secrets)
    let dbInfo: { db: string | null; schema: string | null } | null = null;
    try {
      const r = (await currentPlanPrisma.$queryRaw`SELECT current_database()::text AS db, current_schema()::text AS schema`) as any;
      const row = Array.isArray(r) ? r[0] : r;
      dbInfo = {
        db: typeof row?.db === "string" ? row.db : null,
        schema: typeof row?.schema === "string" ? row.schema : null,
      };
    } catch {
      // ignore
    }

    const parsedDelegate: any = currentPlanPrisma.parsedCurrentPlan;
    const billPlanTemplateDelegate: any = currentPlanPrisma.billPlanTemplate;

    const parsedRows: any[] = await parsedDelegate.findMany({
      orderBy: { updatedAt: "desc" },
      take: limit,
      select: {
        id: true,
        providerName: true,
        planName: true,
        rateType: true,
        variableIndexType: true,
        termMonths: true,
        contractEndDate: true,
        earlyTerminationFeeCents: true,
        baseChargeCentsPerMonth: true,
        energyRateTiersJson: true,
        timeOfUseConfigJson: true,
        billCreditsJson: true,
        updatedAt: true,
      },
    });

    // Use most-recent row per (providerKey, planKey) as the template source.
    const seen = new Set<string>();
    const candidates: any[] = [];
    for (const r of parsedRows) {
      const providerKey = normalizeKey(r?.providerName);
      const planKey = normalizeKey(r?.planName);
      if (!providerKey || !planKey) continue;
      const k = `${providerKey}::${planKey}`;
      if (seen.has(k)) continue;
      seen.add(k);
      candidates.push({ ...r, providerKey, planKey });
    }

    let upserted = 0;
    let skippedMissingNames = 0;
    let errors = 0;

    for (const c of candidates) {
      const providerKey = String(c.providerKey);
      const planKey = String(c.planKey);
      if (!providerKey || !planKey) {
        skippedMissingNames++;
        continue;
      }

      if (dryRun) continue;

      try {
        await billPlanTemplateDelegate.upsert({
          where: { providerNameKey_planNameKey: { providerNameKey: providerKey, planNameKey: planKey } },
          create: {
            providerNameKey: providerKey,
            planNameKey: planKey,
            providerName: c.providerName ?? null,
            planName: c.planName ?? null,
            rateType: c.rateType ?? null,
            variableIndexType: c.variableIndexType ?? null,
            termMonths: typeof c.termMonths === "number" ? c.termMonths : null,
            contractEndDate: c.contractEndDate ? new Date(c.contractEndDate) : null,
            earlyTerminationFeeCents:
              typeof c.earlyTerminationFeeCents === "number" ? c.earlyTerminationFeeCents : null,
            baseChargeCentsPerMonth:
              typeof c.baseChargeCentsPerMonth === "number" ? c.baseChargeCentsPerMonth : null,
            energyRateTiersJson: c.energyRateTiersJson ?? null,
            timeOfUseConfigJson: c.timeOfUseConfigJson ?? null,
            billCreditsJson: c.billCreditsJson ?? null,
          },
          update: {
            providerName: c.providerName ?? null,
            planName: c.planName ?? null,
            rateType: c.rateType ?? null,
            variableIndexType: c.variableIndexType ?? null,
            termMonths: typeof c.termMonths === "number" ? c.termMonths : null,
            contractEndDate: c.contractEndDate ? new Date(c.contractEndDate) : null,
            earlyTerminationFeeCents:
              typeof c.earlyTerminationFeeCents === "number" ? c.earlyTerminationFeeCents : null,
            baseChargeCentsPerMonth:
              typeof c.baseChargeCentsPerMonth === "number" ? c.baseChargeCentsPerMonth : null,
            energyRateTiersJson: c.energyRateTiersJson ?? null,
            timeOfUseConfigJson: c.timeOfUseConfigJson ?? null,
            billCreditsJson: c.billCreditsJson ?? null,
          },
        });
        upserted++;
      } catch (e) {
        errors++;
        // eslint-disable-next-line no-console
        console.error("[admin/current-plan/bill-plan-templates/backfill] upsert failed", {
          providerKey,
          planKey,
          error: e instanceof Error ? e.message : String(e),
        });
      }
    }

    return NextResponse.json({
      ok: true,
      dryRun,
      scanned: parsedRows.length,
      uniqueCandidates: candidates.length,
      upserted,
      skippedMissingNames,
      errors,
      ...(dbInfo ? { dbInfo } : {}),
    });
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error("[admin/current-plan/bill-plan-templates/backfill] failed", e);
    return jsonError(500, "Failed to backfill bill plan templates");
  }
}

