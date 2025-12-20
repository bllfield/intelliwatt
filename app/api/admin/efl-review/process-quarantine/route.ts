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
    const limit = Math.max(
      1,
      Math.min(200, Number.isFinite(limitRaw as any) ? Number(limitRaw) : 50),
    );

    const timeBudgetRaw = body.timeBudgetMs ?? 240_000;
    const timeBudgetMs = Math.max(
      5_000,
      Math.min(
        270_000,
        Number.isFinite(timeBudgetRaw as any) ? Number(timeBudgetRaw) : 240_000,
      ),
    );
    const deadlineMs = Date.now() + timeBudgetMs;
    const shouldStop = () => Date.now() >= deadlineMs - 2_500;

    const dryRun = body.dryRun === true;
    const drain = body.drain === true;
    const cursor = String(body.cursor ?? "").trim() || null;
    const resultsLimitRaw = body.resultsLimit ?? 200;
    const resultsLimit = Math.max(
      0,
      Math.min(
        2000,
        Number.isFinite(resultsLimitRaw as any) ? Number(resultsLimitRaw) : 200,
      ),
    );

    const results: any[] = [];
    let processed = 0;
    let persisted = 0;
    let resolved = 0;
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
          kind: "PLAN_CALC_QUARANTINE",
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
        if (!eflUrl) continue;

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

          let templateAction: "CREATED" | "SKIPPED" = "SKIPPED";
          let persistedRatePlanId: string | null = null;
          let persistNotes: string | null = null;
          let tdspCandidate: string | null = null;
          let tdspIsKnown: boolean = false;

          if (!dryRun && finalStatus === "PASS" && passStrength === "STRONG") {
            const derivedPlanRules =
              (pipeline.derivedForValidation as any)?.derivedPlanRules ??
              pipeline.planRules ??
              null;
            const derivedRateStructure =
              (pipeline.derivedForValidation as any)?.derivedRateStructure ??
              pipeline.rateStructure ??
              null;

            if (derivedPlanRules && derivedRateStructure && det.eflPdfSha256) {
              const prValidation = validatePlanRules(derivedPlanRules as any);
              if (prValidation?.requiresManualReview !== true) {
                const points: any[] = Array.isArray(finalValidation?.points)
                  ? finalValidation.points
                  : [];

                const expectedRateFor = (kwh: number): number | null => {
                  const p = points.find(
                    (x: any) => Number(x?.usageKwh ?? x?.kwh ?? x?.usage) === kwh,
                  );
                  const n = Number(p?.expectedAvgCentsPerKwh);
                  return Number.isFinite(n) ? n : null;
                };

                const modeledRateFor = (kwh: number): number | null => {
                  const p = points.find(
                    (x: any) => Number(x?.usageKwh ?? x?.kwh ?? x?.usage) === kwh,
                  );
                  const n = Number(
                    p?.modeledAvgCentsPerKwh ??
                      p?.modeledAvgPriceCentsPerKwh ??
                      p?.modeledCentsPerKwh,
                  );
                  return Number.isFinite(n) ? n : null;
                };

                const modeledAt = new Date();

                // Prefer inferred TDSP from EFL text; fallback to queue tdspName if present.
                const inferredTdsp = inferTdspTerritoryFromEflText(det.rawText);
                const tdspFromQueue = normalizeUtilityId((it as any)?.tdspName ?? null);
                const tdspCandidateRaw = inferredTdsp ?? (tdspFromQueue ? tdspFromQueue : null);
                tdspCandidate = normalizeUtilityId(tdspCandidateRaw);
                tdspIsKnown = Boolean(tdspCandidate) && isKnownTdspCode(tdspCandidate);

                const saved = await upsertRatePlanFromEfl({
                  mode: "live",
                  eflUrl: fetched.pdfUrl ?? eflUrl,
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
                            source: "quarantine_process",
                            passStrength: passStrength ?? null,
                          },
                        } as any)
                      : (derivedRateStructure as any),
                  validation: prValidation as any,
                });

                const templatePersisted = Boolean((saved as any)?.templatePersisted);
                persistedRatePlanId = (saved as any)?.ratePlan?.id
                  ? String((saved as any).ratePlan.id)
                  : null;

                // Safety: never allow auto-processed templates with unknown/unmapped TDSP to become "available".
                const persistedUtilityId = normalizeUtilityId(
                  (saved as any)?.ratePlan?.utilityId ?? null,
                );
                const persistedUtilityKnown =
                  Boolean(persistedUtilityId) && isKnownTdspCode(persistedUtilityId);
                const templatePersistedOk =
                  templatePersisted && tdspIsKnown && persistedUtilityKnown;

                // If we persisted one anyway, immediately quarantine it and keep the queue OPEN.
                if (templatePersisted && !templatePersistedOk && persistedRatePlanId && !dryRun) {
                  try {
                    const issues: any[] = Array.isArray(
                      (saved as any)?.ratePlan?.eflValidationIssues,
                    )
                      ? [...((saved as any).ratePlan.eflValidationIssues as any[])]
                      : [];
                    issues.push({
                      code: "TEMPLATE_UNKNOWN_UTILITY",
                      severity: "ERROR",
                      message: `Template quarantined by quarantine processor: utilityId is ${persistedUtilityId || "UNKNOWN"} (unmapped).`,
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

                if (templatePersistedOk) {
                  templateAction = "CREATED";
                  persisted++;

                  // Ensure bucket definitions exist for requiredBucketKeys (registry only).
                  try {
                    const rp = (saved as any)?.ratePlan ?? null;
                    const keys = Array.isArray(rp?.requiredBucketKeys)
                      ? (rp.requiredBucketKeys as any[])
                          .map((k: any) => String(k ?? "").trim())
                          .filter(Boolean)
                      : [];
                    if (keys.length > 0) {
                      await ensureBucketsExist({ bucketKeys: keys });
                    }
                  } catch {
                    // ignore
                  }

                  // Resolve this quarantine item now that we have a persisted, non-manual-review template.
                  const now = new Date();
                  await (prisma as any).eflParseReviewQueue.update({
                    where: { id },
                    data: {
                      resolvedAt: now,
                      resolvedBy: "AUTO_FIXED",
                      resolutionNotes: `AUTO_FIXED: template persisted via quarantine processor. ratePlanId=${persistedRatePlanId ?? "—"}`,
                    },
                  });
                  resolved++;
                } else if (templatePersisted && !templatePersistedOk) {
                  templateAction = "SKIPPED";
                  persistNotes = `Template quarantined: TDSP/utility is unknown/unmapped (candidate=${tdspCandidate || "—"} persisted=${persistedUtilityId || "—"}).`;
                } else {
                  const missing = Array.isArray((saved as any)?.missingTemplateFields)
                    ? ((saved as any).missingTemplateFields as string[])
                    : [];
                  if (missing.length) {
                    persistNotes = `Template not persisted (missing fields): ${missing.join(", ")}`;
                  } else {
                    persistNotes = "Template not persisted (manual review gate still active).";
                  }
                }
              } else {
                persistNotes = "Template not persisted (requiresManualReview).";
              }
            } else {
              persistNotes = "Template not persisted (missing derived shapes).";
            }
          } else {
            persistNotes =
              finalStatus !== "PASS"
                ? `SKIP: finalStatus=${finalStatus ?? "—"}`
                : `SKIP: passStrength=${passStrength ?? "—"}`;
          }

          // Best-effort: refresh queue snapshot so manual review has latest parse.
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

          if (!resultsTruncated && results.length < resultsLimit) {
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
              resolvedNow: templateAction === "CREATED",
              notes: persistNotes,
            });
          } else {
            resultsTruncated = true;
          }
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
      fetchFailed,
      truncated,
      nextCursor: truncated ? nextCursor : null,
      iterations,
      resultsTruncated,
      results,
    });
  } catch (e) {
    return jsonError(500, "Unexpected error processing QUARANTINE queue", {
      message: e instanceof Error ? e.message : String(e),
    });
  }
}

