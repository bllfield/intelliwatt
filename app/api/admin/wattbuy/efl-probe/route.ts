import { NextRequest, NextResponse } from "next/server";
import { Buffer } from "node:buffer";

import { wbGetOffers } from "@/lib/wattbuy/client";
import { normalizeOffers } from "@/lib/wattbuy/normalize";
import { computePdfSha256, deterministicEflExtract } from "@/lib/efl/eflExtractor";
import { extractPlanRulesAndRateStructureFromEflText } from "@/lib/efl/planAiExtractor";
import { upsertRatePlanFromEfl } from "@/lib/efl/planPersistence";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

const ADMIN_TOKEN = process.env.ADMIN_TOKEN;

type ProbeBody = {
  wattkey?: string;
  address?: string;
  city?: string;
  state?: string;
  zip?: string;
  mode?: "test" | "live";
};

type PerPlanResult = {
  offerId: string;
  planName: string | null;
  supplierName: string | null;
  eflUrl: string | null;
  pdfSha256: string | null;
  status:
    | "no_efl"
    | "fetched_pdf"
    | "cached_rateplan"
    | "parsed_ok"
    | "parsed_manual_review"
    | "fetch_error"
    | "parse_error";
  requiresManualReview?: boolean;
  parseConfidence?: number | null;
  parseWarnings?: string[];
  notes?: string;
};

type ProbeSuccess = {
  ok: true;
  mode: "test" | "live";
  offersCount: number;
  eflPlansCount: number;
  results: PerPlanResult[];
};

type ProbeError = {
  ok: false;
  error: string;
  details?: unknown;
};

function jsonError(status: number, error: string, details?: unknown) {
  const body: ProbeError = {
    ok: false,
    error,
    ...(details ? { details } : {}),
  };
  return NextResponse.json(body, { status });
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

    let body: ProbeBody;
    try {
      body = (await req.json()) as ProbeBody;
    } catch {
      return jsonError(400, "Invalid JSON body");
    }

    const mode = body.mode ?? "test";
    if (mode !== "test" && mode !== "live") {
      return jsonError(400, 'Invalid mode. Expected "test" or "live".');
    }

    const wattkey = (body.wattkey ?? "").trim();
    const address = (body.address ?? "").trim();
    const city = (body.city ?? "").trim();
    const state = (body.state ?? "").trim();
    const zip = (body.zip ?? "").trim();

    if (!wattkey && (!address || !city || !state || !zip)) {
      return jsonError(
        400,
        "Provide either wattkey or full address (address, city, state, zip).",
      );
    }

    // 1) Fetch offers from WattBuy
    const offersRes = await wbGetOffers(
      wattkey
        ? { wattkey }
        : {
            address,
            city,
            state,
            zip,
          },
    );

    if (!offersRes.ok || !offersRes.data) {
      return jsonError(502, "Failed to fetch offers from WattBuy", {
        status: offersRes.status,
        text: offersRes.text,
      });
    }

    const { offers } = normalizeOffers(offersRes.data);
    const results: PerPlanResult[] = [];

    for (const offer of offers) {
      const offerId = offer.offer_id;
      const planName = offer.plan_name ?? null;
      const supplierName = offer.supplier_name ?? null;
      const eflUrl = offer.docs?.efl ?? null;

      if (!eflUrl) {
        results.push({
          offerId,
          planName,
          supplierName,
          eflUrl: null,
          pdfSha256: null,
          status: "no_efl",
          notes: "No EFL URL present on offer.",
        });
        continue;
      }

      let pdfSha256: string | null = null;

      try {
        // 2) Download the EFL PDF
        const res = await fetch(eflUrl);
        if (!res.ok) {
          results.push({
            offerId,
            planName,
            supplierName,
            eflUrl,
            pdfSha256: null,
            status: "fetch_error",
            notes: `Failed to fetch EFL PDF: HTTP ${res.status} ${res.statusText}`,
          });
          continue;
        }

        const arrayBuffer = await res.arrayBuffer();
        const pdfBytes = Buffer.from(arrayBuffer);
        pdfSha256 = computePdfSha256(pdfBytes);

        // 3) Check for an existing RatePlan with this fingerprint
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
            planName,
            supplierName,
            eflUrl,
            pdfSha256,
            status: "cached_rateplan",
            requiresManualReview: existing.eflRequiresManualReview ?? false,
            notes: "RatePlan with this EFL fingerprint already has a RateStructure.",
          });
          continue;
        }

        // 4) Deterministic extract + AI PlanRules/RateStructure
        let parseConfidence: number | null = null;
        let parseWarnings: string[] = [];
        let requiresManualReview = false;

        try {
          const extract = await deterministicEflExtract(
            pdfBytes,
            async (bytes) => {
              const pdfParseModule = await import("pdf-parse");
              const pdfParseFn: any =
                (pdfParseModule as any).default || (pdfParseModule as any);
              const result = await pdfParseFn(Buffer.from(bytes));
              return (result?.text ?? "").toString();
            },
          );

          const aiResult = await extractPlanRulesAndRateStructureFromEflText({
            input: {
              rawText: extract.rawText,
              repPuctCertificate: extract.repPuctCertificate,
              eflVersionCode: extract.eflVersionCode,
              eflPdfSha256: extract.eflPdfSha256,
              warnings: extract.warnings,
            },
          });

          parseConfidence = aiResult.meta.parseConfidence ?? null;
          parseWarnings = aiResult.meta.parseWarnings ?? [];
          requiresManualReview = aiResult.meta.validation?.requiresManualReview === true;

          if (mode === "live") {
            await upsertRatePlanFromEfl({
              mode,
              eflUrl,
              repPuctCertificate: extract.repPuctCertificate,
              eflVersionCode: extract.eflVersionCode,
              eflPdfSha256: extract.eflPdfSha256,
              providerName: (aiResult.planRules as any)?.repName ?? null,
              planName: (aiResult.planRules as any)?.planMarketingName ?? null,
              planRules: aiResult.planRules,
              rateStructure: aiResult.rateStructure,
              validation: aiResult.meta.validation ?? null,
            });
          }

          results.push({
            offerId,
            planName,
            supplierName,
            eflUrl,
            pdfSha256: extract.eflPdfSha256,
            status: requiresManualReview ? "parsed_manual_review" : "parsed_ok",
            requiresManualReview,
            parseConfidence,
            parseWarnings,
          });
        } catch (parseErr: any) {
          results.push({
            offerId,
            planName,
            supplierName,
            eflUrl,
            pdfSha256,
            status: "parse_error",
            notes:
              parseErr instanceof Error
                ? parseErr.message
                : String(parseErr),
          });
        }
      } catch (outerErr: any) {
        results.push({
          offerId,
          planName,
          supplierName,
          eflUrl,
          pdfSha256,
          status: "fetch_error",
          notes:
            outerErr instanceof Error ? outerErr.message : String(outerErr),
        });
      }
    }

    const payload: ProbeSuccess = {
      ok: true,
      mode,
      offersCount: offers.length,
      eflPlansCount: results.filter((r) => r.eflUrl).length,
      results,
    };

    return NextResponse.json(payload, { status: 200 });
  } catch (error) {
    return jsonError(500, "Unexpected error in /api/admin/wattbuy/efl-probe", {
      message: error instanceof Error ? error.message : String(error),
    });
  }
}


