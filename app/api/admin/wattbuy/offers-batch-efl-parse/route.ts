import { NextRequest, NextResponse } from "next/server";
import { Buffer } from "node:buffer";

import { wbGetOffers } from "@/lib/wattbuy/client";
import { normalizeOffers, type OfferNormalized } from "@/lib/wattbuy/normalize";
import { computePdfSha256 } from "@/lib/efl/eflExtractor";
import { fetchEflPdfFromUrl } from "@/lib/efl/fetchEflPdf";
import { runEflPipelineNoStore } from "@/lib/efl/runEflPipelineNoStore";
import { upsertRatePlanFromEfl } from "@/lib/efl/planPersistence";
import { validatePlanRules } from "@/lib/efl/planEngine";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

const ADMIN_TOKEN = process.env.ADMIN_TOKEN;

type BatchMode = "STORE_TEMPLATES_ON_PASS" | "DRY_RUN";

type BatchRequest = {
  address?: {
    line1?: string | null;
    city?: string | null;
    state?: string | null;
    zip?: string | null;
  } | null;
  offerLimit?: number | null;
  /**
   * Start scanning the WattBuy offers list at this index.
   * Used to chunk large batches across multiple runs to avoid Vercel timeouts.
   */
  startIndex?: number | null;
  /**
   * Max number of offers with EFL URLs to actually run through the EFL pipeline in this run.
   * (Offers without EFL URLs are cheap to skip, so we don't count those here.)
   */
  processLimit?: number | null;
  /**
   * Convenience flag; when true this forces mode="DRY_RUN".
   * UI prefers this over a mode dropdown.
   */
  dryRun?: boolean | null;
  mode?: BatchMode | null;
};

type BatchResultRow = {
  offerId: string | null;
  supplier: string | null;
  planName: string | null;
  termMonths: number | null;
  tdspName: string | null;
  eflUrl: string | null;
  eflPdfSha256: string | null;
  repPuctCertificate: string | null;
  eflVersionCode: string | null;
  validationStatus: string | null;
  originalValidationStatus?: string | null;
  finalValidationStatus?: string | null;
  tdspAppliedMode: string | null;
  parseConfidence: number | null;
  passStrength?: "STRONG" | "WEAK" | "INVALID" | null;
  passStrengthReasons?: string[] | null;
  /**
   * True when we detected a previously persisted RatePlan.rateStructure for this
   * EFL fingerprint (i.e., a “template hit”), and skipped re-parsing.
   *
   * NOTE: In DRY_RUN, templateAction must remain "SKIPPED" per contract; use
   * templateHit to still surface that a template existed.
   */
  templateHit?: boolean;
  templateAction: "TEMPLATE" | "HIT" | "CREATED" | "SKIPPED" | "NOT_ELIGIBLE";
  queueReason?: string | null;
  finalQueueReason?: string | null;
  solverApplied?: string[] | null;
  notes?: string | null;
  diffs?: Array<{
    kwh: number;
    expected: number | null;
    modeled: number | null;
    diff: number | null;
    ok: boolean;
  }>;
};

type BatchResponse =
  | {
      ok: true;
      mode: BatchMode;
      offerCount: number;
      offerSliceStartIndex: number;
      offerSliceEndIndex: number;
      scannedCount: number;
      processedCount: number;
      truncated: boolean;
      nextStartIndex: number | null;
      results: BatchResultRow[];
    }
  | {
      ok: false;
      error: string;
      details?: unknown;
    };

function jsonError(status: number, error: string, details?: unknown) {
  const body: BatchResponse = {
    ok: false,
    error,
    ...(details ? { details } : {}),
  };
  return NextResponse.json(body, { status });
}

function normalizeQueueReason(reason: string | null | undefined): string | null {
  if (!reason) return null;
  // Fix common mojibake sequences such as "â€”" / "â€“" into proper dashes.
  return reason
    .replace(/â€”/g, "—")
    .replace(/â€“/g, "–")
    .replace(/â€™/g, "’");
}

export async function POST(req: NextRequest) {
  try {
    if (!ADMIN_TOKEN) {
      return jsonError(500, "ADMIN_TOKEN is not configured");
    }

    const headerToken = req.headers.get("x-admin-token");
    if (!headerToken || headerToken !== ADMIN_TOKEN) {
      return jsonError(401, "Unauthorized (invalid admin token)");
    }

    let body: BatchRequest;
    try {
      body = (await req.json()) as BatchRequest;
    } catch {
      return jsonError(400, "Invalid JSON body");
    }

    const addr = body.address ?? null;
    const line1 = (addr?.line1 ?? "").trim();
    const city = (addr?.city ?? "").trim();
    const state = (addr?.state ?? "").trim();
    const zip = (addr?.zip ?? "").trim();

    if (!line1 || !city || !state || !zip) {
      return jsonError(400, "address.line1, address.city, address.state, and address.zip are required.");
    }

    const offerLimitRaw = body.offerLimit ?? null;
    // UI wants 500; we still keep a hard cap and chunk actual processing via processLimit.
    const offerLimit = Math.max(
      1,
      Math.min(500, offerLimitRaw && Number.isFinite(offerLimitRaw) ? Number(offerLimitRaw) : 500),
    );

    const dryRunFlag = body.dryRun === true;
    const mode: BatchMode = dryRunFlag
      ? "DRY_RUN"
      : body.mode === "DRY_RUN"
        ? "DRY_RUN"
        : "STORE_TEMPLATES_ON_PASS";

    const startIndexRaw = body.startIndex ?? null;
    const startIndex = Math.max(
      0,
      startIndexRaw && Number.isFinite(startIndexRaw) ? Math.floor(Number(startIndexRaw)) : 0,
    );

    const processLimitRaw = body.processLimit ?? null;
    const processLimit = Math.max(
      1,
      Math.min(
        50,
        processLimitRaw && Number.isFinite(processLimitRaw)
          ? Math.floor(Number(processLimitRaw))
          : 25,
      ),
    );

    // 1) Fetch offers from WattBuy via the existing client + normalizer.
    const offersRes = await wbGetOffers({
      address: line1,
      city,
      state,
      zip,
    });

    if (!offersRes.ok || !offersRes.data) {
      return jsonError(502, "Failed to fetch offers from WattBuy", {
        status: offersRes.status,
        text: offersRes.text,
      });
    }

    const { offers } = normalizeOffers(offersRes.data);
    const offerSliceStartIndex = Math.min(startIndex, offers.length);
    const offerSliceEndIndex = Math.min(offers.length, offerSliceStartIndex + offerLimit);
    const sliced = offers.slice(offerSliceStartIndex, offerSliceEndIndex);

    // Pre-fetch existing templates by EFL URL so we can skip work before even downloading PDFs.
    const eflUrls = (sliced as OfferNormalized[])
      .map((o) => o?.docs?.efl ?? null)
      .filter((u): u is string => Boolean(u));

    const urlToRatePlan = new Map<string, any>();
    if (eflUrls.length > 0) {
      const existingByUrl = (await prisma.ratePlan.findMany({
        where: {
          OR: [
            { eflSourceUrl: { in: eflUrls } },
            { eflUrl: { in: eflUrls } },
          ],
        },
        select: {
          id: true,
          eflSourceUrl: true,
          eflUrl: true,
          eflPdfSha256: true,
          repPuctCertificate: true,
          eflVersionCode: true,
          eflRequiresManualReview: true,
          rateStructure: true,
        },
      })) as any[];

      for (const p of existingByUrl) {
        if (p?.eflSourceUrl) urlToRatePlan.set(String(p.eflSourceUrl), p);
        if (p?.eflUrl) urlToRatePlan.set(String(p.eflUrl), p);
      }
    }

    const results: BatchResultRow[] = [];
    let scannedCount = 0;
    let processedCount = 0; // count of offers with EFL URLs attempted in this run
    let truncated = false;
    let nextStartIndex: number | null = null;

    for (const offer of sliced as OfferNormalized[]) {
      scannedCount++;
      const offerId = offer.offer_id ?? null;
      const supplier: string | null = offer.supplier_name ?? null;
      const planName: string | null = offer.plan_name ?? offer.offer_id ?? null;
      const termMonths: number | null = offer.term_months ?? null;
      const tdspName: string | null =
        (offer.raw as any)?.offer_data?.utility ??
        offer.distributor_name ??
        offer.tdsp ??
        null;
      const eflUrl: string | null = offer.docs?.efl ?? null;

      // Safety: cap how many EFL-bearing offers we run per invocation to avoid Vercel timeouts.
      if (processedCount >= processLimit) {
        truncated = true;
        nextStartIndex = offerSliceStartIndex + (scannedCount - 1);
        break;
      }

      if (!eflUrl) {
        results.push({
          offerId,
          supplier,
          planName,
          termMonths,
          tdspName,
          eflUrl: null,
          eflPdfSha256: null,
          repPuctCertificate: null,
          eflVersionCode: null,
          validationStatus: null,
          tdspAppliedMode: null,
          parseConfidence: null,
          templateAction: "NOT_ELIGIBLE",
          notes: "No EFL URL present on offer.",
        });
        continue;
      }

      // 0) Fast path by URL: if we already have a persisted template for this URL,
      // skip fetching PDFs and re-running the EFL pipeline.
      const existingUrlPlan = urlToRatePlan.get(eflUrl);
      if (
        existingUrlPlan &&
        existingUrlPlan.rateStructure &&
        (existingUrlPlan.eflRequiresManualReview ?? false) === false
      ) {
        results.push({
          offerId,
          supplier,
          planName,
          termMonths,
          tdspName,
          eflUrl,
          eflPdfSha256: existingUrlPlan.eflPdfSha256 ?? null,
          repPuctCertificate: existingUrlPlan.repPuctCertificate ?? null,
          eflVersionCode: existingUrlPlan.eflVersionCode ?? null,
          validationStatus: "PASS",
          originalValidationStatus: "PASS",
          finalValidationStatus: "PASS",
          tdspAppliedMode: null,
          parseConfidence: null,
          passStrength: null,
          passStrengthReasons: null,
          templateHit: true,
          templateAction: mode === "STORE_TEMPLATES_ON_PASS" ? "TEMPLATE" : "SKIPPED",
          queueReason: null,
          finalQueueReason: null,
          solverApplied: null,
          notes: "Template hit (by URL): RatePlan already has rateStructure for this EFL.",
        });
        continue;
      }

      processedCount++;

      try {
        const fetched = await fetchEflPdfFromUrl(eflUrl);
        if (!fetched.ok) {
          results.push({
            offerId,
            supplier,
            planName,
            termMonths,
            tdspName,
            eflUrl,
            eflPdfSha256: null,
            repPuctCertificate: null,
            eflVersionCode: null,
            validationStatus: null,
            tdspAppliedMode: null,
            parseConfidence: null,
            templateAction: "SKIPPED",
            notes: fetched.error,
          });
          continue;
        }

        const pdfBytes = fetched.pdfBytes;
        const pdfSha256 = computePdfSha256(pdfBytes);

        // 2a) Fast path: if we already have a saved RatePlan.rateStructure for
        // this exact EFL fingerprint (and it doesn't require manual review),
        // skip running the expensive EFL pipeline entirely.
        const existing = (await prisma.ratePlan.findFirst({
          where: { eflPdfSha256: pdfSha256 } as any,
        })) as any;

        if (
          existing &&
          existing.rateStructure &&
          (existing.eflRequiresManualReview ?? false) === false
        ) {
          results.push({
            offerId,
            supplier,
            planName,
            termMonths,
            tdspName,
            eflUrl,
            eflPdfSha256: pdfSha256,
            repPuctCertificate: existing.repPuctCertificate ?? null,
            eflVersionCode: existing.eflVersionCode ?? null,
            // IMPORTANT: validationStatus must remain a real validation outcome
            // so downstream consumers that gate on PASS behave correctly.
            // "Template-ness" is represented by templateAction below.
            validationStatus: "PASS",
            originalValidationStatus: "PASS",
            finalValidationStatus: "PASS",
            tdspAppliedMode: null,
            parseConfidence: null,
            passStrength: null,
            passStrengthReasons: null,
            templateHit: true,
            // DRY_RUN contract: templateAction is always SKIPPED (no template
            // handling semantics). In STORE_TEMPLATES_ON_PASS, surface TEMPLATE.
            templateAction: mode === "STORE_TEMPLATES_ON_PASS" ? "TEMPLATE" : "SKIPPED",
            queueReason: null,
            finalQueueReason: null,
            solverApplied: null,
            notes: "Template hit: RatePlan already has rateStructure for this EFL fingerprint.",
          });
          continue;
        }

        // 2b) Run full EFL pipeline WITHOUT persisting templates.
        const pipeline = await runEflPipelineNoStore({
          pdfBytes,
          source: "wattbuy",
          offerMeta: {
            supplier,
            planName,
            termMonths,
            tdspName,
            offerId,
          },
        });

        const det = pipeline.deterministic;
        const baseValidation = (pipeline.validation as any)?.eflAvgPriceValidation ?? null;
        const solved = pipeline.derivedForValidation ?? null;
        const effectiveValidation = pipeline.finalValidation ?? baseValidation ?? null;

        const originalStatus: string | null = baseValidation?.status ?? null;
        const finalStatus: string | null = effectiveValidation?.status ?? null;
        const tdspAppliedMode: string | null =
          effectiveValidation?.assumptionsUsed?.tdspAppliedMode ?? null;
        const solverApplied: string[] | null = Array.isArray(solved?.solverApplied)
          ? (solved.solverApplied as string[])
          : null;
        const passStrength: "STRONG" | "WEAK" | "INVALID" | null =
          (pipeline as any).passStrength ?? null;
        const passStrengthReasons: string[] | null = Array.isArray(
          (pipeline as any).passStrengthReasons,
        )
          ? ((pipeline as any).passStrengthReasons as string[])
          : null;

        const diffs =
          Array.isArray(effectiveValidation?.points) && effectiveValidation.points.length
            ? effectiveValidation.points.map((p: any) => ({
                kwh: p.usageKwh,
                expected: p.expectedAvgCentsPerKwh ?? null,
                modeled: p.modeledAvgCentsPerKwh ?? null,
                diff: p.diffCentsPerKwh ?? null,
                ok: Boolean(p.ok),
              }))
            : undefined;

        // 3) Conditionally persist template ONLY when explicitly requested and
        // the final (derived) validation status is PASS.
        let templateAction: BatchResultRow["templateAction"] = "SKIPPED";
        if (mode === "STORE_TEMPLATES_ON_PASS" && finalStatus === "PASS") {
          try {
            const derivedPlanRules =
              finalStatus === "PASS" && (solved as any)?.derivedPlanRules
                ? (solved as any).derivedPlanRules
                : pipeline.planRules;
            const derivedRateStructure =
              finalStatus === "PASS" && (solved as any)?.derivedRateStructure
                ? (solved as any).derivedRateStructure
                : pipeline.rateStructure;

            if (!derivedPlanRules || !derivedRateStructure || !det.eflPdfSha256) {
              templateAction = "SKIPPED";
            } else {
              const planRulesValidation = validatePlanRules(derivedPlanRules as any);
              if (planRulesValidation?.requiresManualReview === true) {
                // Guardrail: do not persist rateStructure for ambiguous/invalid shapes.
                // IMPORTANT: don't claim CREATED if we didn't store a usable template.
                templateAction = "SKIPPED";
              } else {
                await upsertRatePlanFromEfl({
                  mode: "live",
                  eflUrl,
                  repPuctCertificate: det.repPuctCertificate ?? null,
                  eflVersionCode: det.eflVersionCode ?? null,
                  eflPdfSha256: det.eflPdfSha256,
                  providerName: supplier,
                  planName,
                  planRules: derivedPlanRules as any,
                  rateStructure: derivedRateStructure as any,
                  validation: planRulesValidation as any,
                });
                templateAction = "CREATED";
              }
            }
          } catch {
            // Best-effort: if persistence fails, we still return the pipeline
            // result and mark this as SKIPPED for templateAction.
            templateAction = "SKIPPED";
          }
        }

        const finalQueueReasonRaw: string | null =
          effectiveValidation?.queueReason ?? null;
        let finalQueueReason = normalizeQueueReason(finalQueueReasonRaw);

        // Enrich queueReason with pass-strength information when applicable.
        if (
          finalStatus === "PASS" &&
          passStrength &&
          passStrength !== "STRONG"
        ) {
          const strengthMsg = `PASS strength=${passStrength}${
            passStrengthReasons && passStrengthReasons.length
              ? ` reasons=${passStrengthReasons.join(",")}`
              : ""
          }`;
          finalQueueReason = finalQueueReason
            ? `${finalQueueReason} | ${strengthMsg}`
            : strengthMsg;
        }

        const shouldQueue =
          !!det.eflPdfSha256 &&
          (finalStatus === "FAIL" ||
            (finalStatus === "PASS" &&
              passStrength &&
              passStrength !== "STRONG") ||
            (finalStatus === "SKIP" && !!eflUrl));

        // Queue FAILs, PASS-but-weak/invalid, and SKIPs-with-EFL for admin review
        // (regardless of DRY_RUN vs STORE_TEMPLATES_ON_PASS).
        if (shouldQueue) {
          try {
            const payload = {
              source: "wattbuy_batch",
              eflPdfSha256: det.eflPdfSha256,
              repPuctCertificate: det.repPuctCertificate,
              eflVersionCode: det.eflVersionCode,
              offerId: offerId ?? null,
              supplier: supplier ?? null,
              planName: planName ?? null,
              eflUrl,
              tdspName,
              termMonths,
              rawText: det.rawText,
              planRules: pipeline.planRules ?? null,
              rateStructure: pipeline.rateStructure ?? null,
              validation: pipeline.validation ?? null,
              derivedForValidation: pipeline.derivedForValidation ?? null,
              finalStatus: finalStatus,
              queueReason: finalQueueReason,
              solverApplied: solverApplied ?? [],
            } as const;

            // De-dupe strategy:
            // 1) Prefer reusing an OPEN record for this REP+EFL version (stable across PDF byte drift).
            // 2) Fall back to an OPEN record for this eflUrl (stable across PDF byte drift).
            // 3) Finally, upsert by eflPdfSha256 (strictest fingerprint).
            const repPuct = det.repPuctCertificate ?? null;
            const ver = det.eflVersionCode ?? null;

            const existingOpen = await (prisma as any).eflParseReviewQueue.findFirst({
              where: {
                resolvedAt: null,
                OR: [
                  repPuct && ver ? { repPuctCertificate: repPuct, eflVersionCode: ver } : undefined,
                  eflUrl ? { eflUrl } : undefined,
                  det.eflPdfSha256 ? { eflPdfSha256: det.eflPdfSha256 } : undefined,
                ].filter(Boolean),
              },
              select: { id: true },
            });

            if (existingOpen?.id) {
              await (prisma as any).eflParseReviewQueue.update({
                where: { id: existingOpen.id },
                data: {
                  ...payload,
                },
              });
            } else {
              await (prisma as any).eflParseReviewQueue.upsert({
                where: { eflPdfSha256: det.eflPdfSha256 },
                create: payload,
                update: { ...payload },
              });
            }
          } catch {
            // Best-effort only; do not fail the batch because the review queue write failed.
          }
        }

        results.push({
          offerId,
          supplier,
          planName,
          termMonths,
          tdspName,
          eflUrl,
          eflPdfSha256: det.eflPdfSha256 ?? null,
          repPuctCertificate: det.repPuctCertificate ?? null,
          eflVersionCode: det.eflVersionCode ?? null,
          validationStatus: finalStatus,
          originalValidationStatus: originalStatus,
          finalValidationStatus: finalStatus,
          tdspAppliedMode,
          parseConfidence: pipeline.parseConfidence ?? null,
          passStrength,
          passStrengthReasons,
          templateAction,
          queueReason: finalQueueReason,
          finalQueueReason,
          solverApplied,
          notes:
            det.warnings && det.warnings.length
              ? det.warnings.join(" • ")
              : undefined,
          diffs,
        });
      } catch (err: any) {
        results.push({
          offerId,
          supplier,
          planName,
          termMonths,
          tdspName,
          eflUrl,
          eflPdfSha256: null,
          repPuctCertificate: null,
          eflVersionCode: null,
          validationStatus: null,
          tdspAppliedMode: null,
          parseConfidence: null,
          templateAction: "SKIPPED",
          notes: err?.message || String(err),
        });
      }
    }

    const bodyOut: BatchResponse = {
      ok: true,
      mode,
      offerCount: offers.length,
      offerSliceStartIndex,
      offerSliceEndIndex,
      scannedCount,
      processedCount,
      truncated,
      nextStartIndex,
      results,
    };

    return NextResponse.json(bodyOut);
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error("[ADMIN_WATTBUY_BATCH_EFL_PARSE] Unexpected error:", error);
    return jsonError(
      500,
      "Internal error while running WattBuy batch EFL parser",
      error instanceof Error ? error.message : String(error),
    );
  }
}


