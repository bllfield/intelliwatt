import { NextRequest, NextResponse } from "next/server";
import { Buffer } from "node:buffer";

import { wbGetOffers } from "@/lib/wattbuy/client";
import { normalizeOffers } from "@/lib/wattbuy/normalize";
import { computePdfSha256 } from "@/lib/efl/eflExtractor";
import { getOrCreateEflTemplate } from "@/lib/efl/getOrCreateEflTemplate";
import { runEflPipelineNoStore } from "@/lib/efl/runEflPipelineNoStore";
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
      processedCount: number;
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
    const offerLimit = Math.max(
      1,
      Math.min(50, offerLimitRaw && Number.isFinite(offerLimitRaw) ? Number(offerLimitRaw) : 25),
    );

    const mode: BatchMode = body.mode === "STORE_TEMPLATES_ON_PASS" ? "STORE_TEMPLATES_ON_PASS" : "DRY_RUN";

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
    const sliced = offers.slice(0, offerLimit);

    const results: BatchResultRow[] = [];
    let processedCount = 0;

    for (const offer of sliced) {
      const offerId = (offer as any)?.offer_id ?? null;
      const supplier: string | null =
        (offer as any)?.supplier_name ?? (offer as any)?.supplier ?? null;
      const planName: string | null =
        (offer as any)?.plan_name ?? (offer as any)?.offer_name ?? offerId;
      const termMonths: number | null =
        typeof (offer as any)?.term === "number" && Number.isFinite((offer as any)?.term)
          ? (offer as any).term
          : null;
      const tdspName: string | null =
        (offer as any)?.offer_data?.utility ?? (offer as any)?.tdspName ?? null;
      const eflUrl: string | null = (offer as any)?.docs?.efl ?? null;

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

      processedCount++;

      try {
        const res = await fetch(eflUrl);
        if (!res.ok) {
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
            notes: `Failed to fetch EFL PDF: HTTP ${res.status} ${res.statusText}`,
          });
          continue;
        }

        const arrayBuffer = await res.arrayBuffer();
        const pdfBytes = Buffer.from(arrayBuffer);
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
            const { wasCreated } = await getOrCreateEflTemplate({
              source: "wattbuy",
              rawText: det.rawText,
              eflPdfSha256: det.eflPdfSha256 ?? null,
              repPuctCertificate: det.repPuctCertificate ?? null,
              eflVersionCode: det.eflVersionCode ?? null,
              wattbuy: {
                providerName: supplier,
                planName,
                termMonths,
                tdspName,
                offerId,
              },
            });
            templateAction = wasCreated ? "CREATED" : "HIT";
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
            await (prisma as any).eflParseReviewQueue.upsert({
              where: { eflPdfSha256: det.eflPdfSha256 },
              create: {
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
              },
              update: {
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
              },
            });
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
      processedCount,
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


