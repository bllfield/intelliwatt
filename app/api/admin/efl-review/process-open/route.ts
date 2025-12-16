import { NextRequest, NextResponse } from "next/server";
import { Buffer } from "node:buffer";

import { fetchEflPdfFromUrl } from "@/lib/efl/fetchEflPdf";
import { runEflPipelineNoStore } from "@/lib/efl/runEflPipelineNoStore";
import { upsertRatePlanFromEfl } from "@/lib/efl/planPersistence";
import { validatePlanRules } from "@/lib/efl/planEngine";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

const ADMIN_TOKEN = process.env.ADMIN_TOKEN;

type Body = {
  cursor?: string | null;
  limit?: number | null;
  timeBudgetMs?: number | null;
  dryRun?: boolean | null;
  forceReparseTemplates?: boolean | null;
};

function jsonError(status: number, error: string, details?: unknown) {
  return NextResponse.json(
    { ok: false, error, ...(details ? { details } : {}) },
    { status },
  );
}

export async function POST(req: NextRequest) {
  try {
    if (!ADMIN_TOKEN) return jsonError(500, "ADMIN_TOKEN is not configured");
    const headerToken = req.headers.get("x-admin-token");
    if (!headerToken || headerToken !== ADMIN_TOKEN) {
      return jsonError(401, "Unauthorized (invalid admin token)");
    }

    let body: Body;
    try {
      body = (await req.json()) as Body;
    } catch {
      body = {};
    }

    const limitRaw = body.limit ?? 50;
    const limit = Math.max(1, Math.min(200, Number.isFinite(limitRaw as any) ? Number(limitRaw) : 50));

    const timeBudgetRaw = body.timeBudgetMs ?? 240_000;
    const timeBudgetMs = Math.max(
      5_000,
      Math.min(270_000, Number.isFinite(timeBudgetRaw as any) ? Number(timeBudgetRaw) : 240_000),
    );
    const deadlineMs = Date.now() + timeBudgetMs;
    const shouldStop = () => Date.now() >= deadlineMs - 2_500;

    const dryRun = body.dryRun === true;
    const forceReparseTemplates = body.forceReparseTemplates === true;

    const cursor = String(body.cursor ?? "").trim() || null;

    const items = await (prisma as any).eflParseReviewQueue.findMany({
      where: {
        resolvedAt: null,
        eflUrl: { not: null },
      },
      orderBy: { createdAt: "asc" },
      take: limit,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });

    const results: any[] = [];
    let processed = 0;
    let persisted = 0;
    let resolved = 0;
    let skippedNoUrl = 0;
    let fetchFailed = 0;
    let truncated = false;
    let nextCursor: string | null = null;

    for (const it of items as any[]) {
      if (shouldStop()) {
        truncated = true;
        break;
      }

      const id = String(it?.id ?? "");
      nextCursor = id || nextCursor;

      const eflUrl = String(it?.eflUrl ?? "").trim();
      if (!eflUrl) {
        skippedNoUrl++;
        results.push({ id, offerId: it?.offerId ?? null, status: "SKIP_NO_URL" });
        continue;
      }

      processed++;

      try {
        const fetched = await fetchEflPdfFromUrl(eflUrl);
        if (!fetched.ok) {
          fetchFailed++;
          results.push({
            id,
            offerId: it?.offerId ?? null,
            supplier: it?.supplier ?? null,
            planName: it?.planName ?? null,
            eflUrl,
            status: "FETCH_FAIL",
            error: fetched.error ?? "fetch failed",
          });
          continue;
        }

        const pdfBytes = Buffer.from(fetched.pdfBytes);
        const pipeline = await runEflPipelineNoStore({
          pdfBytes,
          source: "manual",
          offerMeta: {
            supplier: it?.supplier ?? null,
            planName: it?.planName ?? null,
            termMonths: typeof it?.termMonths === "number" ? it.termMonths : null,
            tdspName: it?.tdspName ?? null,
            offerId: it?.offerId ?? null,
          },
        });

        const det = pipeline.deterministic;
        const finalValidation = pipeline.finalValidation ?? null;
        const finalStatus = finalValidation?.status ?? null;
        const passStrength = (pipeline as any).passStrength ?? null;

        // Persist only on PASS+STRONG unless dryRun.
        let templateAction: "CREATED" | "SKIPPED" = "SKIPPED";
        let persistedRatePlanId: string | null = null;
        let persistNotes: string | null = null;

        if (!dryRun && finalStatus === "PASS" && passStrength === "STRONG") {
          const derivedPlanRules =
            (pipeline.derivedForValidation as any)?.derivedPlanRules ?? pipeline.planRules ?? null;
          const derivedRateStructure =
            (pipeline.derivedForValidation as any)?.derivedRateStructure ?? pipeline.rateStructure ?? null;

          if (derivedPlanRules && derivedRateStructure && det.eflPdfSha256) {
            const prValidation = validatePlanRules(derivedPlanRules as any);
            if (prValidation?.requiresManualReview !== true) {
              const points: any[] = Array.isArray(finalValidation?.points) ? finalValidation.points : [];
              const expectedRateFor = (kwh: number): number | null => {
                const p = points.find((x: any) => Number(x?.usageKwh) === kwh);
                const n = Number(p?.expectedAvgCentsPerKwh);
                return Number.isFinite(n) ? n : null;
              };

              const saved = await upsertRatePlanFromEfl({
                mode: "live",
                eflUrl: fetched.pdfUrl ?? eflUrl,
                eflSourceUrl: eflUrl,
                repPuctCertificate: det.repPuctCertificate ?? null,
                eflVersionCode: det.eflVersionCode ?? null,
                eflPdfSha256: det.eflPdfSha256,
                utilityId: "UNKNOWN",
                state: "TX",
                termMonths: typeof it?.termMonths === "number" ? it.termMonths : null,
                rate500: expectedRateFor(500),
                rate1000: expectedRateFor(1000),
                rate2000: expectedRateFor(2000),
                cancelFee: null,
                providerName: it?.supplier ?? null,
                planName: it?.planName ?? null,
                planRules: derivedPlanRules as any,
                rateStructure: derivedRateStructure as any,
                validation: prValidation as any,
              });

              const templatePersisted = Boolean((saved as any)?.templatePersisted);
              persistedRatePlanId = (saved as any)?.ratePlan?.id ? String((saved as any).ratePlan.id) : null;
              if (templatePersisted) {
                templateAction = "CREATED";
                persisted++;

                // Resolve this queue item (and any dup by offerId) now that we have PASS+STRONG template.
                const now = new Date();
                const upd = await (prisma as any).eflParseReviewQueue.updateMany({
                  where: {
                    resolvedAt: null,
                    OR: [
                      id ? { id } : undefined,
                      it?.offerId ? { offerId: String(it.offerId) } : undefined,
                    ].filter(Boolean),
                  },
                  data: {
                    resolvedAt: now,
                    resolvedBy: "auto",
                    resolutionNotes: `AUTO_RESOLVED: PASS STRONG + template persisted via queue_process. ratePlanId=${persistedRatePlanId ?? "—"}`,
                  },
                });
                resolved += Number(upd?.count ?? 0) || 0;
              } else {
                const missing = Array.isArray((saved as any)?.missingTemplateFields)
                  ? ((saved as any).missingTemplateFields as string[])
                  : [];
                if (missing.length) {
                  persistNotes = `Template not persisted (missing fields): ${missing.join(", ")}`;
                }
              }
            }
          }
        }

        // Update queue row with latest parse snapshot (best-effort), even if we didn't resolve it.
        if (!dryRun) {
          try {
            await (prisma as any).eflParseReviewQueue.update({
              where: { id },
              data: {
                eflPdfSha256: det.eflPdfSha256 ?? it.eflPdfSha256 ?? null,
                repPuctCertificate: det.repPuctCertificate ?? it.repPuctCertificate ?? null,
                eflVersionCode: det.eflVersionCode ?? it.eflVersionCode ?? null,
                rawText: det.rawText ?? it.rawText ?? null,
                planRules: pipeline.planRules ?? null,
                rateStructure: pipeline.rateStructure ?? null,
                validation: pipeline.validation ?? null,
                derivedForValidation: pipeline.derivedForValidation ?? null,
                finalStatus: finalStatus ?? null,
                queueReason:
                  String(finalValidation?.queueReason ?? it.queueReason ?? "").trim() ||
                  (persistNotes ?? null),
              },
            });
          } catch {
            // ignore
          }
        }

        // Force-reparse hygiene: if requested, invalidate any existing templates that are missing core fields
        // (this mirrors the batch behavior so bad templates can't keep causing template hits).
        if (!dryRun && forceReparseTemplates && templateAction === "CREATED") {
          try {
            await (prisma as any).ratePlan.updateMany({
              where: {
                isUtilityTariff: false,
                rateStructure: { not: null },
                repPuctCertificate: det.repPuctCertificate ?? undefined,
                planName: it?.planName ? { equals: String(it.planName), mode: "insensitive" } : undefined,
                OR: [{ eflVersionCode: null }, { termMonths: null }, { supplier: null }],
                ...(persistedRatePlanId ? { id: { not: persistedRatePlanId } } : {}),
              },
              data: {
                rateStructure: null,
                eflRequiresManualReview: true,
              },
            });
          } catch {
            // ignore
          }
        }

        results.push({
          id,
          offerId: it?.offerId ?? null,
          supplier: it?.supplier ?? null,
          planName: it?.planName ?? null,
          eflUrl,
          finalStatus,
          passStrength,
          templateAction,
          persistedRatePlanId,
          notes: persistNotes,
        });
      } catch (e: any) {
        results.push({
          id,
          offerId: it?.offerId ?? null,
          supplier: it?.supplier ?? null,
          planName: it?.planName ?? null,
          eflUrl,
          status: "ERROR",
          error: e?.message || String(e),
        });
      }
    }

    if (!truncated && (items as any[]).length === limit) {
      // There may be more items.
      truncated = true;
    }

    return NextResponse.json({
      ok: true,
      dryRun,
      limit,
      processed,
      persisted,
      resolved,
      skippedNoUrl,
      fetchFailed,
      truncated,
      nextCursor: truncated ? nextCursor : null,
      results,
    });
  } catch (e) {
    return jsonError(500, "Unexpected error processing OPEN queue", {
      message: e instanceof Error ? e.message : String(e),
    });
  }
}


