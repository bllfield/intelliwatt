import { NextRequest, NextResponse } from "next/server";
import { Buffer } from "node:buffer";

import { fetchEflPdfFromUrl } from "@/lib/efl/fetchEflPdf";
import { runEflPipelineFromRawTextNoStore } from "@/lib/efl/runEflPipelineFromRawTextNoStore";
import { runEflPipelineNoStore } from "@/lib/efl/runEflPipelineNoStore";
import { upsertRatePlanFromEfl } from "@/lib/efl/planPersistence";
import { validatePlanRules } from "@/lib/efl/planEngine";
import { inferTdspTerritoryFromEflText } from "@/lib/efl/eflValidator";
import { prisma } from "@/lib/db";
import { ensureBucketsExist } from "@/lib/usage/aggregateMonthlyBuckets";

export const dynamic = "force-dynamic";

const ADMIN_TOKEN = process.env.ADMIN_TOKEN;
const KNOWN_TDSP_CODES = ["ONCOR", "CENTERPOINT", "AEP_NORTH", "AEP_CENTRAL", "TNMP"] as const;

function normalizeUtilityId(x: unknown): string {
  return String(x ?? "").trim().toUpperCase();
}

function isKnownTdspCode(x: unknown): boolean {
  return KNOWN_TDSP_CODES.includes(normalizeUtilityId(x) as any);
}

function normalizeUrl(u: unknown): string | null {
  const s = String(u ?? "").trim();
  if (!s) return null;
  try {
    return new URL(s).toString();
  } catch {
    return null;
  }
}

async function buildEflUrlCandidatesForQueueItem(it: any): Promise<string[]> {
  const out: string[] = [];
  const seen = new Set<string>();
  const push = (u: unknown) => {
    const n = normalizeUrl(u);
    if (!n) return;
    if (seen.has(n)) return;
    seen.add(n);
    out.push(n);
  };

  // 0) The queue row URL itself (may be WAF-protected enrollment page).
  push(it?.eflUrl);

  // 1) If we have a ratePlanId, prefer its stored URLs (often direct PDF).
  const ratePlanId = String(it?.ratePlanId ?? "").trim();
  if (ratePlanId) {
    try {
      const rp = await (prisma as any).ratePlan.findUnique({
        where: { id: ratePlanId },
        select: { eflSourceUrl: true, eflUrl: true } as any,
      });
      push(rp?.eflSourceUrl);
      push(rp?.eflUrl);
    } catch {
      // ignore
    }
  }

  // 2) If we have offerId, masterPlan.docs.efl tends to be the WAF-safe direct PDF link.
  const offerId = String(it?.offerId ?? "").trim();
  if (offerId) {
    try {
      const mp = await (prisma as any).masterPlan.findFirst({
        where: { offerId: offerId },
        select: { eflUrl: true, docs: true } as any,
      });
      push(mp?.eflUrl);
      push((mp as any)?.docs?.efl);
    } catch {
      // ignore
    }
    // Also try via offerIdRatePlanMap if present.
    try {
      const link = await (prisma as any).offerIdRatePlanMap.findUnique({
        where: { offerId: offerId },
        include: { ratePlan: true } as any,
      });
      push((link as any)?.ratePlan?.eflSourceUrl);
      push((link as any)?.ratePlan?.eflUrl);
    } catch {
      // ignore
    }
  }

  return out;
}

type Body = {
  cursor?: string | null;
  limit?: number | null;
  timeBudgetMs?: number | null;
  dryRun?: boolean | null;
  forceReparseTemplates?: boolean | null;
  /**
   * When true, keep paging and processing until timeBudgetMs is exhausted
   * (or the queue is empty), instead of returning after one page.
   */
  drain?: boolean | null;
  /**
   * Optional cap on `results[]` returned (to keep responses small when draining).
   * Counters are always complete even when results are truncated.
   */
  resultsLimit?: number | null;
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
    const drain = body.drain === true;
    const resultsLimitRaw = body.resultsLimit ?? 200;
    const resultsLimit = Math.max(
      0,
      Math.min(
        2000,
        Number.isFinite(resultsLimitRaw as any) ? Number(resultsLimitRaw) : 200,
      ),
    );

    const cursor = String(body.cursor ?? "").trim() || null;

    const results: any[] = [];
    let processed = 0;
    let persisted = 0;
    let resolved = 0;
    let skippedNoUrl = 0;
    let fetchFailed = 0;
    let truncated = false;
    let nextCursor: string | null = null;
    let resultsTruncated = false;
    let iterations = 0;
    let cursorLocal: string | null = cursor;

    while (!shouldStop()) {
      iterations++;
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
        ...(cursorLocal ? { cursor: { id: cursorLocal }, skip: 1 } : {}),
      });

      if (!Array.isArray(items) || items.length === 0) {
        truncated = false;
        nextCursor = null;
        break;
      }

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
          if (!resultsTruncated && results.length < resultsLimit) {
            results.push({
              id,
              offerId: it?.offerId ?? null,
              status: "SKIP_NO_URL",
            });
          } else {
            resultsTruncated = true;
          }
          continue;
        }

        processed++;

        try {
          const candidates = await buildEflUrlCandidatesForQueueItem(it);
          const tried: Array<{ url: string; error: string | null; notes: string[] }> = [];

          let fetched: any = null;
          let usedUrl: string | null = null;
          let usedRawTextFallback = false;

          for (const u of candidates.length ? candidates : [eflUrl]) {
            const res = await fetchEflPdfFromUrl(u);
            if ((res as any)?.ok === true) {
              fetched = res;
              usedUrl = u;
              break;
            }
            tried.push({
              url: u,
              error: (res as any)?.error ?? "fetch failed",
              notes: Array.isArray((res as any)?.notes) ? (res as any).notes : [],
            });
          }

          if (!fetched || (fetched as any).ok !== true) {
            // Fallback: if we already have rawText + sha in the queue row, we can still
            // run the EFL pipeline without fetching the PDF again (WAF/TLS blocks).
            const rawTextStored = String((it as any)?.rawText ?? "").trim();
            const shaStored = String((it as any)?.eflPdfSha256 ?? "").trim();
            if (rawTextStored && shaStored) {
              usedRawTextFallback = true;
            } else {
              fetchFailed++;
            }

            const last = tried.length ? tried[tried.length - 1] : null;
            const errorMsg = last?.error ?? "fetch failed";
            const errorShort = String(errorMsg).split(/\r?\n/)[0].trim().slice(0, 240);

            // Best-effort: store richer reason so stats can reveal WAF/403 vs missing PDF.
            try {
              if (!dryRun) {
                await (prisma as any).eflParseReviewQueue.update({
                  where: { id },
                  data: {
                    // Keep queueReason short/stable for stats & UI (avoid DB size issues).
                    // Store full diagnostics in validation.fetch below.
                    queueReason: (usedRawTextFallback
                      ? `FETCH_FAIL: ${errorShort} | RAWTEXT_FALLBACK_ELIGIBLE`
                      : `FETCH_FAIL: ${errorShort}`
                    ).slice(0, 4000),
                    validation: {
                      fetch: { usedUrl, candidates, tried, errorFull: errorMsg },
                      rawTextFallbackEligible: usedRawTextFallback,
                    } as any,
                  },
                });
              }
            } catch {
              // ignore
            }

            if (usedRawTextFallback) {
              // Continue with the rawText pipeline below.
            } else {
            if (!resultsTruncated && results.length < resultsLimit) {
              results.push({
                id,
                offerId: it?.offerId ?? null,
                supplier: it?.supplier ?? null,
                planName: it?.planName ?? null,
                eflUrl,
                status: "FETCH_FAIL",
                // Keep error short for callers/logs; preserve full text separately.
                error: errorShort,
                errorFull: errorMsg,
                usedUrl,
                candidatesTried: tried.length,
                tried: tried.slice(0, 6),
              });
            } else {
              resultsTruncated = true;
            }
            continue;
            }
          }

          const pipeline = usedRawTextFallback
            ? await runEflPipelineFromRawTextNoStore({
                rawText: String((it as any)?.rawText ?? ""),
                eflPdfSha256: String((it as any)?.eflPdfSha256 ?? ""),
                repPuctCertificate: (it as any)?.repPuctCertificate ?? null,
                eflVersionCode: (it as any)?.eflVersionCode ?? null,
                source: "queue_rawtext",
                offerMeta: {
                  supplier: it?.supplier ?? null,
                  planName: it?.planName ?? null,
                  termMonths: typeof it?.termMonths === "number" ? it.termMonths : null,
                  tdspName: it?.tdspName ?? null,
                  offerId: it?.offerId ?? null,
                },
              })
            : await runEflPipelineNoStore({
                pdfBytes: Buffer.from((fetched as any).pdfBytes),
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
        let tdspCandidate: string | null = null;
        let tdspIsKnown: boolean = false;
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

              // Prefer inferred TDSP from EFL text; fallback to queue tdspName if present.
              const inferredTdsp = inferTdspTerritoryFromEflText(det.rawText);
              const tdspFromQueue = normalizeUtilityId((it as any)?.tdspName ?? null);
              const tdspCandidateRaw = inferredTdsp ?? (tdspFromQueue ? tdspFromQueue : null);
              tdspCandidate = normalizeUtilityId(tdspCandidateRaw);
              tdspIsKnown = Boolean(tdspCandidate) && isKnownTdspCode(tdspCandidate);

              const saved = await upsertRatePlanFromEfl({
                mode: "live",
                // When we used rawText fallback (no PDF fetch), keep the best URL we have for the template.
                eflUrl: usedRawTextFallback ? (usedUrl ?? eflUrl) : ((fetched as any)?.pdfUrl ?? eflUrl),
                eflSourceUrl: eflUrl,
                repPuctCertificate: det.repPuctCertificate ?? null,
                eflVersionCode: det.eflVersionCode ?? null,
                eflPdfSha256: det.eflPdfSha256,
                utilityId: tdspCandidate || "UNKNOWN",
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

              // Safety: never allow auto-processed templates with unknown/unmapped TDSP to become "available".
              const persistedUtilityId = normalizeUtilityId((saved as any)?.ratePlan?.utilityId ?? null);
              const persistedUtilityKnown = Boolean(persistedUtilityId) && isKnownTdspCode(persistedUtilityId);
              const templatePersistedOk = templatePersisted && tdspIsKnown && persistedUtilityKnown;

              // If we persisted one anyway, immediately quarantine it and keep the queue OPEN.
              if (templatePersisted && !templatePersistedOk && persistedRatePlanId && !dryRun) {
                try {
                  const issues: any[] = Array.isArray((saved as any)?.ratePlan?.eflValidationIssues)
                    ? [...((saved as any).ratePlan.eflValidationIssues as any[])]
                    : [];
                  issues.push({
                    code: "TEMPLATE_UNKNOWN_UTILITY",
                    severity: "ERROR",
                    message: `Template quarantined by queue processor: utilityId is ${persistedUtilityId || "UNKNOWN"} (unmapped).`,
                  });
                  await (prisma as any).ratePlan.update({
                    where: { id: persistedRatePlanId },
                    data: {
                      rateStructure: null,
                      eflRequiresManualReview: true,
                      eflValidationIssues: issues,
                      planCalcStatus: "UNKNOWN",
                      planCalcReasonCode: "MISSING_TEMPLATE",
                      requiredBucketKeys: [],
                      supportedFeatures: {} as any,
                      planCalcDerivedAt: new Date(),
                    },
                  });
                } catch {
                  // ignore
                }
              }

              // Ensure bucket definitions exist for requiredBucketKeys so downstream "auto-create monthly buckets"
              // has the registry it needs. (Home-specific monthly totals are produced later, on-demand, per homeId.)
              if (templatePersistedOk && planCalcSnapshot.requiredBucketKeys.length > 0) {
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
              if (templatePersistedOk) {
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
              } else if (templatePersisted && !templatePersistedOk) {
                templateAction = "SKIPPED";
                persistNotes = `Template quarantined: TDSP/utility is unknown/unmapped (candidate=${tdspCandidate || "—"} persisted=${persistedUtilityId || "—"}).`;
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
                tdspName: tdspIsKnown ? tdspCandidate : ((it as any)?.tdspName ?? null),
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
          if (!resultsTruncated && results.length < resultsLimit) {
            results.push({
              id,
              offerId: it?.offerId ?? null,
              supplier: it?.supplier ?? null,
              planName: it?.planName ?? null,
              eflUrl,
              status: "ERROR",
              error: e?.message || String(e),
            });
          } else {
            resultsTruncated = true;
          }
        }

        if (results.length >= resultsLimit) resultsTruncated = true;
      }

      cursorLocal = nextCursor;
      if (!drain) {
        // IMPORTANT: if we hit the time budget mid-page, `truncated` is already true.
        // Do not overwrite it based on item count.
        if (!truncated) truncated = (items as any[]).length === limit;
        break;
      }
      if ((items as any[]).length < limit) {
        // likely exhausted the queue
        // Do not claim exhaustion if we already timed out mid-loop.
        if (!truncated) {
          truncated = false;
          nextCursor = null;
        }
        break;
      }
    }

    return NextResponse.json({
      ok: true,
      dryRun,
      drain,
      limit,
      processed,
      persisted,
      resolved,
      skippedNoUrl,
      fetchFailed,
      truncated,
      nextCursor: truncated ? nextCursor : null,
      iterations,
      resultsTruncated,
      results,
    });
  } catch (e) {
    return jsonError(500, "Unexpected error processing OPEN queue", {
      message: e instanceof Error ? e.message : String(e),
    });
  }
}

