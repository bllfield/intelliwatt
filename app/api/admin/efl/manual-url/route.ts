import { NextRequest, NextResponse } from "next/server";
import { Buffer } from "node:buffer";

import { fetchEflPdfFromUrl } from "@/lib/efl/fetchEflPdf";
import { runEflPipeline } from "@/lib/efl/runEflPipeline";
import { prisma } from "@/lib/db";

const MAX_PREVIEW_CHARS = 20000;

export const dynamic = "force-dynamic";

type ManualUrlBody = {
  eflUrl?: string;
  forceReparse?: boolean;
  overridePdfUrl?: string;
  offerId?: string;
};

export async function POST(req: NextRequest) {
  try {
    let body: ManualUrlBody;
    try {
      body = (await req.json()) as ManualUrlBody;
    } catch {
      return NextResponse.json({ ok: false, error: "Invalid JSON body." }, { status: 400 });
    }

    const eflUrlRaw = (body.eflUrl ?? "").trim();
    if (!eflUrlRaw) {
      return NextResponse.json({ ok: false, error: "eflUrl is required." }, { status: 400 });
    }

    // Normalize URL
    let eflUrl: string;
    try {
      eflUrl = new URL(eflUrlRaw).toString();
    } catch {
      return NextResponse.json({ ok: false, error: "Invalid eflUrl." }, { status: 400 });
    }

    const forceReparse = body.forceReparse === true;

    const offerId = (body.offerId ?? "").trim() || null;
    const overridePdfUrlRaw = (body.overridePdfUrl ?? "").trim();
    let overridePdfUrl: string | null = null;
    if (overridePdfUrlRaw) {
      try {
        overridePdfUrl = new URL(overridePdfUrlRaw).toString();
      } catch {
        return NextResponse.json({ ok: false, error: "Invalid overridePdfUrl." }, { status: 400 });
      }
    }

    // If an override is provided, treat it as the authoritative PDF location and
    // treat eflUrl as the source URL (e.g., WattBuy enrollment link).
    const pdfFetchUrl = overridePdfUrl ?? eflUrl;
    const effectiveEflUrl = overridePdfUrl ?? eflUrl;
    const eflSourceUrl = eflUrl;

    const fetched = await fetchEflPdfFromUrl(pdfFetchUrl);
    if (!fetched.ok) {
      return NextResponse.json(
        {
          ok: false,
          error: `Failed to fetch EFL PDF: ${fetched.error}`,
          details: {
            eflUrl,
            overridePdfUrl,
            pdfFetchUrl,
            // Include fetcher notes to diagnose WAF/TLS/CORS-style blocking.
            notes: fetched.notes ?? [],
            tip:
              "If this host blocks server-side fetch (common WAF 403), use the Override EFL PDF URL field with a direct PDF link, or upload the PDF in the Upload tab.",
          },
        },
        { status: 502 },
      );
    }

    const pdfBuffer = Buffer.from(fetched.pdfBytes);

    const pipelineResult = await runEflPipeline({
      source: "manual_url",
      actor: "admin",
      dryRun: false,
      offerId,
      eflUrl: effectiveEflUrl,
      eflSourceUrl,
      pdfBytes: pdfBuffer,
    });

    // Auto-resolve matching OPEN queue rows when we successfully persisted a template.
    let autoResolvedQueueCount = 0;
    if (pipelineResult.ratePlanId && !pipelineResult.queued) {
      try {
        const now = new Date();
        const sha = String(pipelineResult.eflPdfSha256 ?? "").trim();
        const rep = String(pipelineResult.repPuctCertificate ?? "").trim();
        const ver = String(pipelineResult.eflVersionCode ?? "").trim();
        const whereOr = [
          sha ? { eflPdfSha256: sha } : undefined,
          offerId ? { offerId: String(offerId) } : undefined,
          rep && ver ? { repPuctCertificate: rep, eflVersionCode: ver } : undefined,
        ].filter(Boolean);
        if (whereOr.length > 0) {
          const upd = await (prisma as any).eflParseReviewQueue.updateMany({
            where: { resolvedAt: null, OR: whereOr },
            data: {
              resolvedAt: now,
              resolvedBy: "manual_url",
              resolutionNotes: `AUTO_RESOLVED: template persisted via manual-url. ratePlanId=${pipelineResult.ratePlanId ?? "—"}`,
            },
          });
          autoResolvedQueueCount = Number(upd?.count ?? 0) || 0;
        }
      } catch {
        autoResolvedQueueCount = 0;
      }
    }

    const aiEnabled = process.env.OPENAI_IntelliWatt_Fact_Card_Parser === "1";
    const hasKey = Boolean(process.env.OPENAI_API_KEY && process.env.OPENAI_API_KEY.trim().length > 0);

    return NextResponse.json({
      ok: true,
      build: {
        vercelGitCommitSha: process.env.VERCEL_GIT_COMMIT_SHA ?? null,
        vercelEnv: process.env.VERCEL_ENV ?? null,
      },
      eflUrl: effectiveEflUrl,
      eflSourceUrl,
      offerId,
      eflPdfSha256: pipelineResult.eflPdfSha256 ?? null,
      repPuctCertificate: pipelineResult.repPuctCertificate ?? null,
      eflVersionCode: pipelineResult.eflVersionCode ?? null,
      warnings: pipelineResult.deterministicWarnings ?? [],
      prompt: "EFL PDF parsed by OpenAI using the standard planRules/rateStructure contract.",
      rawTextPreview: String(pipelineResult.rawTextPreview ?? "").slice(0, MAX_PREVIEW_CHARS),
      rawTextLength: pipelineResult.rawTextLen ?? 0,
      rawTextTruncated: Boolean(pipelineResult.rawTextTruncated ?? false),
      planRules: pipelineResult.planRules ?? null,
      rateStructure: pipelineResult.rateStructure ?? null,
      parseConfidence: pipelineResult.parseConfidence ?? null,
      parseWarnings: pipelineResult.parseWarnings ?? [],
      validation: pipelineResult.validation ?? null,
      derivedForValidation: pipelineResult.derivedForValidation ?? null,
      passStrength: pipelineResult.passStrength ?? null,
      passStrengthReasons: pipelineResult.passStrengthReasons ?? [],
      passStrengthOffPointDiffs: pipelineResult.passStrengthOffPointDiffs ?? null,
      templatePersisted: Boolean(pipelineResult.ratePlanId),
      persistedRatePlanId: pipelineResult.ratePlanId ?? null,
      autoResolvedQueueCount,
      persistAttempted: true,
      persistUsedDerived: true,
      persistNotes: pipelineResult.queued ? (pipelineResult.queueReason ?? null) : null,
      extractorMethod: pipelineResult.extractorMethod ?? "pdftotext",
      ai: {
        enabled: aiEnabled,
        hasKey,
        used: aiEnabled && hasKey,
      },
      pipelineResult,
    });

    /*
    const { template, warnings: topWarnings } = await getOrCreateEflTemplate({
      source: "manual_upload",
      pdfBytes: pdfBuffer,
      filename: null,
      forceReparse,
    });

    const rawText = template.rawText ?? "";
    const rawTextTruncated = rawText.length > MAX_PREVIEW_CHARS;
    const rawTextPreview = rawTextTruncated ? rawText.slice(0, MAX_PREVIEW_CHARS) : rawText;

    const aiEnabled = process.env.OPENAI_IntelliWatt_Fact_Card_Parser === "1";
    const hasKey = !!process.env.OPENAI_API_KEY && process.env.OPENAI_API_KEY.trim().length > 0;
    const aiUsed =
      aiEnabled &&
      hasKey &&
      !Array.isArray(template.parseWarnings)
        ? false
        : !((template.parseWarnings ?? []).some((w: string) => w.includes("AI_DISABLED_OR_MISSING_KEY")));

    const ai: { enabled: boolean; hasKey: boolean; used: boolean; reason?: string } = {
      enabled: aiEnabled,
      hasKey,
      used: aiUsed,
    };

    if (!aiUsed) {
      ai.reason = !aiEnabled
        ? "AI disabled via OPENAI_IntelliWatt_Fact_Card_Parser flag."
        : !hasKey
          ? "OPENAI_API_KEY is missing or empty."
          : "AI parser skipped; see parseWarnings for details.";
    }

    // Run deterministic solver pass for avg-price validation (best-effort)
    let derivedForValidation: any = null;
    try {
      const baseValidation = (template.validation as any)?.eflAvgPriceValidation ?? null;
      derivedForValidation = await solveEflValidationGaps({
        rawText,
        planRules: template.planRules ?? null,
        rateStructure: template.rateStructure ?? null,
        validation: baseValidation,
      });
    } catch {
      derivedForValidation = null;
    }

    // PASS strength scoring (ops visibility): show why an item is PASS but quarantined (WEAK/INVALID),
    // especially for off-point deviations at 750/1250/1500 kWh.
    let passStrength: "STRONG" | "WEAK" | "INVALID" | null = null;
    let passStrengthReasons: string[] = [];
    let passStrengthOffPointDiffs:
      | Array<{
          usageKwh: number;
          expectedInterp: number;
          modeled: number | null;
          diff: number | null;
          ok: boolean;
        }>
      | null = null;
    try {
      const validationAfter =
        (derivedForValidation as any)?.validationAfter ??
        (template.validation as any)?.eflAvgPriceValidation ??
        null;
      const finalStatus = validationAfter?.status ?? null;
      if (finalStatus === "PASS") {
        const finalPlanRules =
          (derivedForValidation as any)?.derivedPlanRules ?? template.planRules ?? null;
        const finalRateStructure =
          (derivedForValidation as any)?.derivedRateStructure ?? template.rateStructure ?? null;
        const scored = await scoreEflPassStrength({
          rawText,
          validation: validationAfter,
          planRules: finalPlanRules,
          rateStructure: finalRateStructure,
        });
        passStrength = scored.strength ?? null;
        passStrengthReasons = Array.isArray(scored.reasons) ? scored.reasons : [];
        passStrengthOffPointDiffs = Array.isArray(scored.offPointDiffs)
          ? scored.offPointDiffs
          : null;
      }
    } catch {
      passStrength = null;
      passStrengthReasons = [];
      passStrengthOffPointDiffs = null;
    }

    // Best-effort persistence: if the EFL PASSes after solver (or already PASSed) and PlanRules are
    // structurally valid, upsert a RatePlan template so it appears in Templates.
    let templatePersisted: boolean = false;
    let persistedRatePlanId: string | null = null;
    let autoResolvedQueueCount: number = 0;
    let queueAutoResolveUpdatedCount: number = 0;
    let persistAttempted: boolean = false;
    let persistNotes: string | null = null;
    let persistUsedDerived: boolean = false;
    let queueAutoResolveAttempted: boolean = false;
    let queueAutoResolveCriteria: any = null;
    let queueAutoResolveOpenMatchesPreview: any[] = [];
    let queueAutoResolveOpenMatchesCount: number = 0;
    let offerRateMapLinkAttempted: boolean = false;
    let offerRateMapLinkUpdatedCount: number = 0;
    let offerIdRatePlanMapAttempted: boolean = false;
    let offerIdRatePlanMapOk: boolean = false;
    let offerIdRatePlanMapOfferId: string | null = null;
    let offerIdRatePlanMapRatePlanId: string | null = null;
    let offerIdRatePlanMapError: string | null = null;
    let offerIdRatePlanMapBackfillAttempted: boolean = false;
    let offerIdRatePlanMapBackfillOfferIdsCount: number = 0;
    let offerIdRatePlanMapBackfillLinkedCount: number = 0;
    let offerIdRatePlanMapBackfillError: string | null = null;
    try {
      const validationAfter =
        (derivedForValidation as any)?.validationAfter ??
        (template.validation as any)?.eflAvgPriceValidation ??
        null;
      const finalStatus = validationAfter?.status ?? null;
      const planRulesBase = template.planRules ?? null;

      // Prefer solver-derived shapes when available (aligns manual loader with batch + queue processors).
      const planRulesForPersist =
        (derivedForValidation as any)?.derivedPlanRules ?? planRulesBase ?? null;
      const rateStructureForPersist =
        (derivedForValidation as any)?.derivedRateStructure ?? template.rateStructure ?? null;
      const canonicalRateStructure =
        rateStructureForPersist ?? (planRulesForPersist ? planRulesToRateStructure(planRulesForPersist as any) : null);
      persistUsedDerived = Boolean((derivedForValidation as any)?.derivedPlanRules || (derivedForValidation as any)?.derivedRateStructure);

      if (finalStatus === "PASS" && planRulesForPersist && canonicalRateStructure) {
        persistAttempted = true;
        const prValidation = validatePlanRules(planRulesForPersist as any);
        if (prValidation?.requiresManualReview !== true) {
          const tdsp = inferTdspTerritoryFromEflText(rawText);

          const avgRows = Array.isArray(validationAfter?.avgTableRows) ? validationAfter.avgTableRows : [];
          const pick = (kwh: number): number | null => {
            const row = avgRows.find(
              (r: any) => Number(r?.usageKwh ?? r?.kwh ?? r?.usage) === kwh,
            );
            const v = Number(row?.avgPriceCentsPerKwh);
            return Number.isFinite(v) ? v : null;
          };

          const modeledPick = (kwh: number): number | null => {
            const pts = Array.isArray((validationAfter as any)?.points)
              ? ((validationAfter as any).points as any[])
              : [];
            const row = pts.find(
              (r: any) => Number(r?.usageKwh ?? r?.kwh ?? r?.usage) === kwh,
            );
            const v = Number(
              row?.modeledAvgCentsPerKwh ??
                row?.modeledAvgPriceCentsPerKwh ??
                row?.modeledCentsPerKwh,
            );
            return Number.isFinite(v) ? v : null;
          };

          const names = extractProviderAndPlanNameFromEflText(rawText);

          const modeledAt = new Date();

          // Cancellation / early termination fee (best-effort). Prefer explicit text surfaced by parser warnings,
          // otherwise regex-extract from raw EFL text. We do NOT invent values.
          const cancelFeeText: string | null = (() => {
            const candidates = [
              ...((Array.isArray(template.parseWarnings) ? template.parseWarnings : []) as string[]),
              ...((Array.isArray(topWarnings) ? topWarnings : []) as string[]),
            ]
              .map((s) => String(s ?? "").trim())
              .filter(Boolean);

            const warned = candidates.find((s) =>
              /(termination\s+fee|early\s+termination|cancellation\s+fee)/i.test(s),
            );
            if (warned) {
              const mWarn =
                warned.match(/\$([0-9]{1,4}(?:\.[0-9]{1,2})?)/) ?? null;
              if (mWarn?.[1]) {
                // Keep the admin table value consistent: store the $ amount (and formula hint if present),
                // not a verbose sentence.
                const hasMonthsRemaining = /months?\s+remaining/i.test(warned);
                return hasMonthsRemaining
                  ? `$${mWarn[1]} × months remaining`
                  : `$${mWarn[1]}`;
              }
            }

            const m =
              rawText.match(
                /(?:early\s+termination|termination|cancellation)\s+fee[\s\S]{0,180}?\$([0-9]{1,4}(?:\.[0-9]{1,2})?)/i,
              ) ?? null;
            if (m?.[1]) return `$${m[1]}`;

            return null;
          })();

          const saved = await upsertRatePlanFromEfl({
            mode: "live",
            eflUrl: effectiveEflUrl,
            eflSourceUrl,
            repPuctCertificate: template.repPuctCertificate ?? null,
            eflVersionCode: template.eflVersionCode ?? null,
            eflPdfSha256: template.eflPdfSha256,
            utilityId: tdsp ?? "UNKNOWN",
            state: "TX",
            termMonths:
              typeof (planRulesForPersist as any)?.termMonths === "number"
                ? (planRulesForPersist as any).termMonths
                : null,
            rate500: pick(500),
            rate1000: pick(1000),
            rate2000: pick(2000),
            modeledRate500: modeledPick(500),
            modeledRate1000: modeledPick(1000),
            modeledRate2000: modeledPick(2000),
            modeledEflAvgPriceValidation: validationAfter ?? null,
            modeledComputedAt: modeledAt,
            ...(cancelFeeText ? { cancelFee: cancelFeeText } : {}),
            providerName: names.providerName,
            planName: names.planName,
            planRules: planRulesForPersist as any,
            rateStructure:
              canonicalRateStructure && typeof canonicalRateStructure === "object"
                ? ({
                    ...(canonicalRateStructure as any),
                    __eflAvgPriceValidation: validationAfter ?? null,
                    __eflAvgPriceEvidence: {
                      computedAt: modeledAt.toISOString(),
                      source: "manual_url",
                      passStrength: passStrength ?? null,
                    },
                  } as any)
                : (canonicalRateStructure as any),
            validation: prValidation as any,
          });

          templatePersisted = Boolean((saved as any)?.templatePersisted);
          persistedRatePlanId = (saved as any)?.ratePlan?.id
            ? String((saved as any).ratePlan.id)
            : null;

          // If a template was persisted but plan-calc introspection indicates a non-fixed, non-TOU-bucket-gated
          // failure/unsupported shape, queue it for admin review (PLAN_CALC_QUARANTINE).
          try {
            if (templatePersisted && persistedRatePlanId) {
              const rsForIntrospection = canonicalRateStructure;
              const intro = introspectPlanFromRateStructure({ rateStructure: rsForIntrospection });
              const rc = String(intro?.planCalc?.planCalcReasonCode ?? "").trim();
              const shouldQueue =
                intro?.planCalc?.planCalcStatus === "NOT_COMPUTABLE" &&
                rc &&
                rc !== "FIXED_RATE_OK" &&
                rc !== "TOU_REQUIRES_USAGE_BUCKETS_PHASE2";

              if (shouldQueue) {
                await (prisma as any).eflParseReviewQueue.upsert({
                  where: { eflPdfSha256: template.eflPdfSha256 },
                  create: {
                    source: "manual_url",
                    kind: "PLAN_CALC_QUARANTINE",
                    dedupeKey: `plan_calc:${persistedRatePlanId}`,
                    ratePlanId: persistedRatePlanId,
                    eflPdfSha256: template.eflPdfSha256,
                    repPuctCertificate: template.repPuctCertificate ?? null,
                    eflVersionCode: template.eflVersionCode ?? null,
                    offerId: offerId ?? null,
                    supplier: names.providerName ?? null,
                    planName: names.planName ?? null,
                    eflUrl: effectiveEflUrl,
                    tdspName: tdsp ?? null,
                    termMonths:
                      typeof (planRulesForPersist as any)?.termMonths === "number"
                        ? (planRulesForPersist as any).termMonths
                        : null,
                    rawText: template.rawText ?? null,
                    planRules: planRulesForPersist as any,
                    rateStructure: rsForIntrospection as any,
                    validation: prValidation as any,
                    derivedForValidation: derivedForValidation ?? null,
                    finalStatus: "NEEDS_REVIEW",
                    queueReason: `PLAN_CALC_BLOCKED: ${rc}`,
                    solverApplied: null,
                    resolvedAt: null,
                    resolvedBy: null,
                    resolutionNotes: null,
                  },
                  update: {
                    kind: "PLAN_CALC_QUARANTINE",
                    dedupeKey: `plan_calc:${persistedRatePlanId}`,
                    ratePlanId: persistedRatePlanId,
                    offerId: offerId ?? null,
                    supplier: names.providerName ?? null,
                    planName: names.planName ?? null,
                    eflUrl: effectiveEflUrl,
                    tdspName: tdsp ?? null,
                    termMonths:
                      typeof (planRulesForPersist as any)?.termMonths === "number"
                        ? (planRulesForPersist as any).termMonths
                        : null,
                    rawText: template.rawText ?? null,
                    planRules: planRulesForPersist as any,
                    rateStructure: rsForIntrospection as any,
                    validation: prValidation as any,
                    derivedForValidation: derivedForValidation ?? null,
                    finalStatus: "NEEDS_REVIEW",
                    queueReason: `PLAN_CALC_BLOCKED: ${rc}`,
                    resolvedAt: null,
                    resolvedBy: null,
                    resolutionNotes: null,
                  },
                });
              }
            }
          } catch {
            // ignore (never block manual-url flow)
          }

          const missing = Array.isArray((saved as any)?.missingTemplateFields)
            ? ((saved as any).missingTemplateFields as string[])
            : [];
          if (!templatePersisted && missing.length) {
            persistNotes = `Template not persisted (missing fields): ${missing.join(", ")}`;
          }

          // Link WattBuy offer_id -> RatePlan.id (authoritative fingerprint) without creating OfferRateMap rows.
          // Safety: OfferRateMap requires rateConfigId, so we only update existing rows.
          try {
            if (templatePersisted && persistedRatePlanId && offerId) {
              offerRateMapLinkAttempted = true;
              const upd = await (prisma as any).offerRateMap.updateMany({
                where: { offerId: String(offerId) },
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
            if (templatePersisted && persistedRatePlanId && offerId) {
              offerIdRatePlanMapAttempted = true;
              offerIdRatePlanMapOfferId = String(offerId);
              const now = new Date();
              const row = await (prisma as any).offerIdRatePlanMap.upsert({
                where: { offerId: String(offerId) },
                create: {
                  offerId: String(offerId),
                  ratePlanId: persistedRatePlanId,
                  lastLinkedAt: now,
                  linkedBy: "manual-url",
                },
                update: {
                  ratePlanId: persistedRatePlanId,
                  lastLinkedAt: now,
                  linkedBy: "manual-url",
                },
                select: { ratePlanId: true },
              });
              offerIdRatePlanMapOk = true;
              offerIdRatePlanMapRatePlanId = row?.ratePlanId ? String(row.ratePlanId) : null;
              offerIdRatePlanMapError = null;
            }
          } catch (e: any) {
            offerIdRatePlanMapAttempted = true;
            offerIdRatePlanMapOk = false;
            offerIdRatePlanMapOfferId = offerId ? String(offerId) : null;
            offerIdRatePlanMapRatePlanId = null;
            offerIdRatePlanMapError = e?.message ? String(e.message) : String(e);
          }

          // Backfill links for all offers whose OfferRateMap.eflUrl matches this run.
          // This is the main "why didn't the site update?" fix: the site keys off offerId -> RatePlan links.
          try {
            if (templatePersisted && persistedRatePlanId) {
              offerIdRatePlanMapBackfillAttempted = true;
              const urlsToMatch = Array.from(
                new Set(
                  [
                    // upstream landing/enroll URL
                    eflSourceUrl,
                    // resolved/normalized URL used for persistence
                    effectiveEflUrl,
                    // resolved direct PDF URL from fetcher (if different)
                    (fetched as any)?.pdfUrl ?? null,
                  ]
                    .map((x) => String(x ?? "").trim())
                    .filter(Boolean),
                ),
              );

              if (urlsToMatch.length) {
                const rows = await (prisma as any).offerRateMap.findMany({
                  where: { eflUrl: { in: urlsToMatch } },
                  select: { offerId: true },
                  take: 1000,
                });
                const offerIds = Array.from(
                  new Set(
                    (Array.isArray(rows) ? rows : [])
                      .map((r: any) => String(r?.offerId ?? "").trim())
                      .filter(Boolean),
                  ),
                );
                offerIdRatePlanMapBackfillOfferIdsCount = offerIds.length;

                if (offerIds.length) {
                  const now = new Date();

                  // Best-effort: update OfferRateMap.ratePlanId as well (some endpoints read it).
                  try {
                    await (prisma as any).offerRateMap.updateMany({
                      where: { offerId: { in: offerIds } },
                      data: { ratePlanId: persistedRatePlanId, lastSeenAt: now },
                    });
                  } catch {
                    // ignore
                  }

                  let linked = 0;
                  for (const oid of offerIds) {
                    try {
                      await (prisma as any).offerIdRatePlanMap.upsert({
                        where: { offerId: oid },
                        create: {
                          offerId: oid,
                          ratePlanId: persistedRatePlanId,
                          lastLinkedAt: now,
                          linkedBy: "manual-url:eflUrl-backfill",
                          notes: `Backfilled by EFL URL match (${urlsToMatch[0]}).`,
                        },
                        update: {
                          ratePlanId: persistedRatePlanId,
                          lastLinkedAt: now,
                          linkedBy: "manual-url:eflUrl-backfill",
                          notes: `Backfilled by EFL URL match (${urlsToMatch[0]}).`,
                        },
                      });
                      linked += 1;
                    } catch {
                      // ignore per-offer; keep going
                    }
                  }
                  offerIdRatePlanMapBackfillLinkedCount = linked;
                }
              }
              offerIdRatePlanMapBackfillError = null;
            }
          } catch (e: any) {
            offerIdRatePlanMapBackfillAttempted = true;
            offerIdRatePlanMapBackfillError = e?.message ? String(e.message) : String(e);
          }

          // If this EFL was previously quarantined (OPEN review-queue item), auto-resolve it now
          // that we have a persisted template from a PASS run AND passStrength is STRONG.
          try {
            const repPuct = template.repPuctCertificate ?? null;
            const ver = template.eflVersionCode ?? null;
            const shouldAutoResolveQueue = templatePersisted && passStrength === "STRONG";
            queueAutoResolveAttempted = shouldAutoResolveQueue;
            queueAutoResolveCriteria = {
              shouldAutoResolveQueue,
              passStrength,
              templatePersisted,
              offerId,
              repPuctCertificate: repPuct,
              eflVersionCode: ver,
              eflPdfSha256: template.eflPdfSha256 ?? null,
            };

            // Auto-resolve matching (safety):
            // - allow exact eflPdfSha256 when present
            // - allow offerId when present
            // - allow repPuctCertificate + eflVersionCode when both present
            // - DO NOT resolve by eflUrl alone (too risky); if sha is missing, leave OPEN rather than clear the wrong row.
            const whereOr = [
              template.eflPdfSha256 ? { eflPdfSha256: template.eflPdfSha256 } : undefined,
              offerId ? { offerId } : undefined,
              repPuct && ver ? { repPuctCertificate: repPuct, eflVersionCode: ver } : undefined,
            ].filter(Boolean);

            if (whereOr.length > 0) {
              // Preview what we'd resolve so the UI can show exactly what matched.
              const matches = await (prisma as any).eflParseReviewQueue.findMany({
                where: { resolvedAt: null, OR: whereOr },
                select: {
                  id: true,
                  offerId: true,
                  eflUrl: true,
                  repPuctCertificate: true,
                  eflVersionCode: true,
                  eflPdfSha256: true,
                  supplier: true,
                  planName: true,
                },
                orderBy: { createdAt: "asc" },
                take: 25,
              });
              queueAutoResolveOpenMatchesPreview = Array.isArray(matches) ? matches : [];

              // Count all OPEN matches (not just preview) so admins can see full impact.
              try {
                const c = await (prisma as any).eflParseReviewQueue.count({
                  where: { resolvedAt: null, OR: whereOr },
                });
                queueAutoResolveOpenMatchesCount = Number(c ?? 0) || 0;
              } catch {
                queueAutoResolveOpenMatchesCount = queueAutoResolveOpenMatchesPreview.length;
              }
            }

            const updated = shouldAutoResolveQueue
              ? await (prisma as any).eflParseReviewQueue.updateMany({
                  where: { resolvedAt: null, OR: whereOr },
                  data: {
                    resolvedAt: new Date(),
                    resolvedBy: "auto",
                    resolutionNotes: `AUTO_RESOLVED: templatePersisted=true via manual_url. ratePlanId=${persistedRatePlanId ?? "—"}`,
                  },
                })
              : { count: 0 };

            autoResolvedQueueCount = Number(updated?.count ?? 0) || 0;
            queueAutoResolveUpdatedCount = autoResolvedQueueCount;
          } catch {
            autoResolvedQueueCount = 0;
            queueAutoResolveUpdatedCount = 0;
          }
        }
      }
    } catch {
      // If persistence/auto-resolve/linking fails mid-flight, reset diagnostics to safe defaults
      // so the API response never implies that OfferRateMap linking completed.
      templatePersisted = false;
      persistedRatePlanId = null;
      autoResolvedQueueCount = 0;
      queueAutoResolveUpdatedCount = 0;
      offerRateMapLinkAttempted = false;
      offerRateMapLinkUpdatedCount = 0;
      offerIdRatePlanMapAttempted = false;
      offerIdRatePlanMapOk = false;
      offerIdRatePlanMapOfferId = null;
      offerIdRatePlanMapRatePlanId = null;
      offerIdRatePlanMapError = null;
      offerIdRatePlanMapBackfillAttempted = false;
      offerIdRatePlanMapBackfillOfferIdsCount = 0;
      offerIdRatePlanMapBackfillLinkedCount = 0;
      offerIdRatePlanMapBackfillError = null;
    }

    return NextResponse.json({
      ok: true,
      build: {
        vercelGitCommitSha: process.env.VERCEL_GIT_COMMIT_SHA ?? null,
        vercelEnv: process.env.VERCEL_ENV ?? null,
      },
      eflUrl: effectiveEflUrl,
      eflSourceUrl,
      offerId,
      eflPdfSha256: template.eflPdfSha256,
      repPuctCertificate: template.repPuctCertificate,
      eflVersionCode: template.eflVersionCode,
      warnings: topWarnings,
      prompt: "EFL PDF parsed by OpenAI using the standard planRules/rateStructure contract.",
      rawTextPreview,
      rawTextLength: rawText.length,
      rawTextTruncated,
      planRules: template.planRules,
      rateStructure: template.rateStructure,
      parseConfidence: template.parseConfidence,
      parseWarnings: template.parseWarnings,
      validation: template.validation ?? null,
      derivedForValidation,
      passStrength,
      passStrengthReasons,
      passStrengthOffPointDiffs,
      templatePersisted,
      persistedRatePlanId,
      offerRateMapLinkAttempted,
      offerRateMapLinkUpdatedCount,
      offerIdRatePlanMapAttempted,
      offerIdRatePlanMapOk,
      offerIdRatePlanMapOfferId,
      offerIdRatePlanMapRatePlanId,
      offerIdRatePlanMapError,
      offerIdRatePlanMapBackfillAttempted,
      offerIdRatePlanMapBackfillOfferIdsCount,
      offerIdRatePlanMapBackfillLinkedCount,
      offerIdRatePlanMapBackfillError,
      autoResolvedQueueCount,
      persistAttempted,
      persistUsedDerived,
      persistNotes,
      queueAutoResolveAttempted,
      queueAutoResolveCriteria,
      queueAutoResolveOpenMatchesCount,
      queueAutoResolveOpenMatchesPreview,
      queueAutoResolveUpdatedCount,
      extractorMethod: template.extractorMethod ?? "pdftotext",
      ai,
    });
    */
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error("[EFL_MANUAL_URL] Failed to process EFL URL:", error);
    const message =
      error instanceof Error ? error.message : "We couldn't process that EFL URL. Please try again.";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}


