import { NextRequest, NextResponse } from "next/server";
import { Buffer } from "node:buffer";

import { fetchEflPdfFromUrl } from "@/lib/efl/fetchEflPdf";
import { runEflPipelineNoStore } from "@/lib/efl/runEflPipelineNoStore";
import { upsertRatePlanFromEfl } from "@/lib/efl/planPersistence";
import { validatePlanRules } from "@/lib/efl/planEngine";
import { inferTdspTerritoryFromEflText } from "@/lib/efl/eflValidator";
import { prisma } from "@/lib/db";
import { ensureBucketsExist } from "@/lib/usage/aggregateMonthlyBuckets";

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
        // IMPORTANT: This endpoint is for the EFL_PARSE queue only.
        // PLAN_CALC_QUARANTINE is intentionally sticky and must not be auto-processed here.
        kind: "EFL_PARSE",
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
        let offerRateMapLinkAttempted: boolean = false;
        let offerRateMapLinkUpdatedCount: number = 0;
        let offerIdRatePlanMapAttempted: boolean = false;
        let offerIdRatePlanMapOk: boolean = false;
        let offerIdRatePlanMapOfferId: string | null = null;
        let offerIdRatePlanMapRatePlanId: string | null = null;
        let offerIdRatePlanMapError: string | null = null;
        let requiredBucketKeysEnsured: { ensured: number; skipped: number; error?: string } | null = null;
        let planCalcSnapshot:
          | {
              planCalcStatus: string | null;
              planCalcReasonCode: string | null;
              requiredBucketKeys: string[];
            }
          | null = null;

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
                const p = points.find(
                  (x: any) =>
                    Number(x?.usageKwh ?? x?.kwh ?? x?.usage) === kwh,
                );
                const n = Number(p?.expectedAvgCentsPerKwh);
                return Number.isFinite(n) ? n : null;
              };

              const modeledRateFor = (kwh: number): number | null => {
                const p = points.find(
                  (x: any) =>
                    Number(x?.usageKwh ?? x?.kwh ?? x?.usage) === kwh,
                );
                const n = Number(
                  p?.modeledAvgCentsPerKwh ??
                    p?.modeledAvgPriceCentsPerKwh ??
                    p?.modeledCentsPerKwh,
                );
                return Number.isFinite(n) ? n : null;
              };

              const modeledAt = new Date();

              // Cancellation / early termination fee (best-effort). Do NOT invent values.
              const cancelFeeText: string | null = (() => {
                const src = String(det.rawText ?? "").trim();
                if (!src) return null;
                const m =
                  src.match(
                    /(?:early\s+termination|termination|cancellation)\s+fee[\s\S]{0,180}?\$([0-9]{1,4}(?:\.[0-9]{1,2})?)/i,
                  ) ?? null;
                if (m?.[1]) return `$${m[1]}`;
                return null;
              })();

              const saved = await upsertRatePlanFromEfl({
                mode: "live",
                eflUrl: fetched.pdfUrl ?? eflUrl,
                eflSourceUrl: eflUrl,
                repPuctCertificate: det.repPuctCertificate ?? null,
                eflVersionCode: det.eflVersionCode ?? null,
                eflPdfSha256: det.eflPdfSha256,
                utilityId: inferTdspTerritoryFromEflText(det.rawText) ?? "UNKNOWN",
                state: "TX",
                termMonths: typeof it?.termMonths === "number" ? it.termMonths : null,
                rate500: expectedRateFor(500),
                rate1000: expectedRateFor(1000),
                rate2000: expectedRateFor(2000),
                modeledRate500: modeledRateFor(500),
                modeledRate1000: modeledRateFor(1000),
                modeledRate2000: modeledRateFor(2000),
                modeledEflAvgPriceValidation: finalValidation ?? null,
                modeledComputedAt: modeledAt,
                ...(cancelFeeText ? { cancelFee: cancelFeeText } : {}),
                providerName: it?.supplier ?? null,
                planName: it?.planName ?? null,
                planRules: derivedPlanRules as any,
                rateStructure:
                  derivedRateStructure && typeof derivedRateStructure === "object"
                    ? ({
                        ...(derivedRateStructure as any),
                        __eflAvgPriceValidation: finalValidation ?? null,
                        __eflAvgPriceEvidence: {
                          computedAt: modeledAt.toISOString(),
                          source: "queue_process",
                          passStrength: passStrength ?? null,
                        },
                      } as any)
                    : (derivedRateStructure as any),
                validation: prValidation as any,
              });

              const templatePersisted = Boolean((saved as any)?.templatePersisted);
              persistedRatePlanId = (saved as any)?.ratePlan?.id ? String((saved as any).ratePlan.id) : null;
              planCalcSnapshot = (() => {
                const rp = (saved as any)?.ratePlan ?? null;
                const keys = Array.isArray(rp?.requiredBucketKeys)
                  ? (rp.requiredBucketKeys as any[]).map((k: any) => String(k ?? "").trim()).filter(Boolean)
                  : [];
                return {
                  planCalcStatus: rp?.planCalcStatus ? String(rp.planCalcStatus) : null,
                  planCalcReasonCode: rp?.planCalcReasonCode ? String(rp.planCalcReasonCode) : null,
                  requiredBucketKeys: keys,
                };
              })();

              // Ensure bucket definitions exist for requiredBucketKeys so downstream "auto-create monthly buckets"
              // has the registry it needs. (Home-specific monthly totals are produced later, on-demand, per homeId.)
              if (templatePersisted && planCalcSnapshot.requiredBucketKeys.length > 0) {
                try {
                  const ensured = await ensureBucketsExist({
                    bucketKeys: planCalcSnapshot.requiredBucketKeys,
                  });
                  requiredBucketKeysEnsured = {
                    ensured: Array.isArray(ensured?.ensured) ? ensured.ensured.length : 0,
                    skipped: Array.isArray(ensured?.skipped) ? ensured.skipped.length : 0,
                  };
                } catch (e: any) {
                  requiredBucketKeysEnsured = {
                    ensured: 0,
                    skipped: 0,
                    error: e?.message ? String(e.message) : String(e),
                  };
                }
              }
              if (templatePersisted) {
                templateAction = "CREATED";
                persisted++;

                // Link WattBuy offer_id -> RatePlan.id (authoritative fingerprint) without creating OfferRateMap rows.
                // Safety: OfferRateMap requires rateConfigId, so we only update existing rows.
                try {
                  if (it?.offerId && persistedRatePlanId) {
                    offerRateMapLinkAttempted = true;
                    const upd = await (prisma as any).offerRateMap.updateMany({
                      where: { offerId: String(it.offerId) },
                      data: { ratePlanId: persistedRatePlanId, lastSeenAt: new Date() },
                    });
                    offerRateMapLinkUpdatedCount = Number(upd?.count ?? 0) || 0;
                  }
                } catch {
                  offerRateMapLinkAttempted = true;
                  offerRateMapLinkUpdatedCount = 0;
                }

                // Canonical link: offerId -> RatePlan.id (works even when OfferRateMap doesn't exist)
                try {
                  if (it?.offerId && persistedRatePlanId) {
                    offerIdRatePlanMapAttempted = true;
                    offerIdRatePlanMapOfferId = String(it.offerId);
                    offerIdRatePlanMapRatePlanId = persistedRatePlanId;
                    const now = new Date();
                    await (prisma as any).offerIdRatePlanMap.upsert({
                      where: { offerId: String(it.offerId) },
                      create: {
                        offerId: String(it.offerId),
                        ratePlanId: persistedRatePlanId,
                        lastLinkedAt: now,
                        linkedBy: "process-open",
                      },
                      update: {
                        ratePlanId: persistedRatePlanId,
                        lastLinkedAt: now,
                        linkedBy: "process-open",
                      },
                    });
                    offerIdRatePlanMapOk = true;
                    offerIdRatePlanMapError = null;
                  }
                } catch (e: any) {
                  offerIdRatePlanMapAttempted = true;
                  offerIdRatePlanMapOk = false;
                  offerIdRatePlanMapError = e?.message ? String(e.message) : String(e);
                }

                // Resolve this queue item (and any dup by offerId) now that we have PASS+STRONG template.
                const now = new Date();
                const upd = await (prisma as any).eflParseReviewQueue.updateMany({
                  where: {
                    resolvedAt: null,
                    OR: [
                      // Safety-first matching: resolve by sha/offerId/rep+version only (never by URL).
                      det.eflPdfSha256 ? { eflPdfSha256: det.eflPdfSha256 } : undefined,
                      it?.offerId ? { offerId: String(it.offerId) } : undefined,
                      det.repPuctCertificate && det.eflVersionCode
                        ? { repPuctCertificate: det.repPuctCertificate, eflVersionCode: det.eflVersionCode }
                        : undefined,
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
          planCalc: planCalcSnapshot,
          requiredBucketKeysEnsured,
          offerRateMapLinkAttempted,
          offerRateMapLinkUpdatedCount,
          offerIdRatePlanMapAttempted,
          offerIdRatePlanMapOk,
          offerIdRatePlanMapOfferId,
          offerIdRatePlanMapRatePlanId,
          offerIdRatePlanMapError,
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


