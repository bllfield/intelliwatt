import { NextResponse, type NextRequest } from "next/server";

import { prisma } from "@/lib/db";
import { derivePlanCalcRequirementsFromTemplate } from "@/lib/plan-engine/planComputability";

export const dynamic = "force-dynamic";

const ADMIN_TOKEN = process.env.ADMIN_TOKEN;

function jsonError(status: number, error: string, detail?: any) {
  return NextResponse.json({ ok: false, error, detail: detail ?? null }, { status });
}

type Body = {
  confirm?: string | null;
  /**
   * Optional safety filter: only revalidate templates currently marked COMPUTABLE.
   * Defaults to true (safe).
   */
  onlyComputable?: boolean | null;
  supplierContains?: string | null;
};

export async function POST(req: NextRequest) {
  try {
    if (!ADMIN_TOKEN) return jsonError(500, "ADMIN_TOKEN is not configured");
    const headerToken = req.headers.get("x-admin-token");
    if (!headerToken || headerToken !== ADMIN_TOKEN) return jsonError(401, "Unauthorized");

    const sp = req.nextUrl.searchParams;
    const limit = Math.max(1, Math.min(200, Number(sp.get("limit") ?? 50) || 50));
    const timeBudgetMs = Math.max(500, Math.min(240_000, Number(sp.get("timeBudgetMs") ?? 110_000) || 110_000));
    const cursorId = (sp.get("cursorId") ?? "").trim() || null;

    let body: Body = {};
    try {
      body = (await req.json()) as Body;
    } catch {
      body = {};
    }

    const confirm = String(body.confirm ?? "").trim();
    if (confirm !== "REVALIDATE_TEMPLATES") {
      return jsonError(400, 'Missing/invalid confirm. To proceed, set confirm="REVALIDATE_TEMPLATES".');
    }

    const onlyComputable = body.onlyComputable !== false;
    const supplierContains = String(body.supplierContains ?? "").trim();

    const startMs = Date.now();
    const notes: string[] = [];

    const where: any = {
      isUtilityTariff: false,
      rateStructure: { not: null },
      eflRequiresManualReview: false,
      ...(onlyComputable ? { planCalcStatus: "COMPUTABLE" } : {}),
      ...(supplierContains ? { supplier: { contains: supplierContains, mode: "insensitive" } } : {}),
    };
    if (cursorId) where.id = { gt: cursorId };

    const plansPlus = await (prisma as any).ratePlan.findMany({
      where,
      orderBy: { id: "asc" },
      take: limit + 1,
      select: {
        id: true,
        supplier: true,
        planName: true,
        termMonths: true,
        utilityId: true,
        eflUrl: true,
        eflSourceUrl: true,
        repPuctCertificate: true,
        eflVersionCode: true,
        eflPdfSha256: true,
        rateStructure: true,
        eflValidationIssues: true,
        planCalcStatus: true,
        planCalcReasonCode: true,
      } as any,
    });
    const hasMore = Array.isArray(plansPlus) && plansPlus.length > limit;
    const plans = hasMore ? plansPlus.slice(0, limit) : plansPlus;

    let processedCount = 0;
    let quarantinedCount = 0;
    let keptCount = 0;
    let errorsCount = 0;
    let lastCursorId: string | null = null;
    let ranOutOfTime = false;

    for (const p of plans as any[]) {
      lastCursorId = String(p.id);
      if (Date.now() - startMs > timeBudgetMs) {
        ranOutOfTime = true;
        break;
      }

      processedCount++;
      try {
        const derived = derivePlanCalcRequirementsFromTemplate({ rateStructure: p.rateStructure });
        const isStillComputable = derived.planCalcStatus === "COMPUTABLE";

        if (isStillComputable) {
          keptCount++;
          // Best-effort: keep derived fields in sync without changing the template.
          await (prisma as any).ratePlan.update({
            where: { id: p.id },
            data: {
              planCalcVersion: derived.planCalcVersion,
              planCalcStatus: derived.planCalcStatus,
              planCalcReasonCode: derived.planCalcReasonCode,
              requiredBucketKeys: derived.requiredBucketKeys,
              supportedFeatures: derived.supportedFeatures as any,
              planCalcDerivedAt: new Date(),
            },
          });
          continue;
        }

        // Quarantine: remove from available templates + queue for admin review.
        const reason = String(derived.planCalcReasonCode ?? "REVALIDATION_FAILED").trim() || "REVALIDATION_FAILED";
        const issues: any[] = Array.isArray(p.eflValidationIssues) ? [...p.eflValidationIssues] : [];
        issues.push({
          code: "TEMPLATE_QUARANTINED_BY_REVALIDATION",
          severity: "ERROR",
          message: `Template quarantined by admin revalidation: ${reason}`,
        });

        // Upsert queue item (best-effort; never block).
        try {
          const sha = String(p.eflPdfSha256 ?? "").trim();
          if (sha) {
            await (prisma as any).eflParseReviewQueue.upsert({
              where: { eflPdfSha256: sha },
              create: {
                source: "admin_revalidate_templates",
                kind: "PLAN_CALC_QUARANTINE",
                dedupeKey: `plan_calc:${String(p.id)}`,
                ratePlanId: String(p.id),
                eflPdfSha256: sha,
                repPuctCertificate: p.repPuctCertificate ?? null,
                eflVersionCode: p.eflVersionCode ?? null,
                offerId: null,
                supplier: p.supplier ?? null,
                planName: p.planName ?? null,
                eflUrl: (p.eflUrl ?? p.eflSourceUrl) ?? null,
                tdspName: p.utilityId ?? null,
                termMonths: typeof p.termMonths === "number" ? p.termMonths : null,
                rawText: null,
                planRules: null,
                rateStructure: (p.rateStructure ?? null) as any,
                validation: { revalidation: { reasonCode: reason, derived } } as any,
                derivedForValidation: null,
                finalStatus: "NEEDS_REVIEW",
                queueReason: `REVALIDATE_QUARANTINE: ${reason}`,
                solverApplied: null,
                resolvedAt: null,
                resolvedBy: null,
                resolutionNotes: "Auto-queued by admin revalidation tool.",
              },
              update: {
                kind: "PLAN_CALC_QUARANTINE",
                dedupeKey: `plan_calc:${String(p.id)}`,
                ratePlanId: String(p.id),
                supplier: p.supplier ?? null,
                planName: p.planName ?? null,
                eflUrl: (p.eflUrl ?? p.eflSourceUrl) ?? null,
                tdspName: p.utilityId ?? null,
                termMonths: typeof p.termMonths === "number" ? p.termMonths : null,
                // Keep whatever rawText existed, but preserve the template snapshot for review.
                rateStructure: (p.rateStructure ?? null) as any,
                finalStatus: "NEEDS_REVIEW",
                queueReason: `REVALIDATE_QUARANTINE: ${reason}`,
                resolvedAt: null,
                resolvedBy: null,
                resolutionNotes: "Auto-queued by admin revalidation tool.",
              },
            });
          }
        } catch {
          // ignore
        }

        await (prisma as any).ratePlan.update({
          where: { id: p.id },
          data: {
            rateStructure: null,
            eflRequiresManualReview: true,
            eflValidationIssues: issues,
            planCalcVersion: derived.planCalcVersion,
            planCalcStatus: derived.planCalcStatus,
            planCalcReasonCode: derived.planCalcReasonCode,
            requiredBucketKeys: derived.requiredBucketKeys,
            supportedFeatures: derived.supportedFeatures as any,
            planCalcDerivedAt: new Date(),
          },
        });

        quarantinedCount++;
      } catch (e: any) {
        errorsCount++;
        notes.push(`ERROR ratePlanId=${String(p?.id ?? "—")} ${e?.message ?? String(e)}`);
      }
    }

    const truncated = Boolean(lastCursorId && (ranOutOfTime || hasMore));
    const nextCursorId = truncated ? lastCursorId : null;

    return NextResponse.json({
      ok: true,
      processedCount,
      quarantinedCount,
      keptCount,
      errorsCount,
      truncated,
      nextCursorId,
      lastCursorId,
      notes: notes.slice(0, 50),
    });
  } catch (e: any) {
    return jsonError(500, "Internal error", { message: e?.message ?? String(e) });
  }
}

