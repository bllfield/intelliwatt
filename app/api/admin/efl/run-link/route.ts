import { NextRequest, NextResponse } from "next/server";
import { Buffer } from "node:buffer";

import { computePdfSha256, deterministicEflExtract } from "@/lib/efl/eflExtractor";
import { fetchEflPdfFromUrl } from "@/lib/efl/fetchEflPdf";
import {
  extractPlanRulesAndRateStructureFromEflText,
  extractPlanRulesAndRateStructureFromEflUrlVision,
} from "@/lib/efl/planAiExtractor";
import { upsertRatePlanFromEfl } from "@/lib/efl/planPersistence";

const ADMIN_TOKEN = process.env.ADMIN_TOKEN;

type RunLinkBody = {
  eflUrl?: string;
  mode?: "test" | "live";
};

type RunLinkSuccess = {
  ok: true;
  mode: "test" | "live";
  eflUrl: string;
  steps: string[];
  pdfSha256: string;
  contentType: string | null;
  contentLength: number | null;
  warnings: string[];
  notes: string;
  cleanedText?: string;
  planRules?: unknown;
  rateStructure?: unknown;
  parseConfidence?: number;
  parseWarnings?: string[];
  eflVersionCode?: string | null;
  extractorMethod?: "pdf-parse" | "pdfjs" | "pdftotext" | "vision";
};

type RunLinkError = {
  ok: false;
  error: string;
  details?: unknown;
};

function jsonError(status: number, error: string, details?: unknown) {
  const body: RunLinkError = {
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

    let body: RunLinkBody;
    try {
      body = (await req.json()) as RunLinkBody;
    } catch {
      return jsonError(400, "Invalid JSON body");
    }

    const rawUrl = (body.eflUrl ?? "").trim();
    const mode = body.mode ?? "test";

    if (!rawUrl) {
      return jsonError(400, "Missing required field: eflUrl");
    }

    if (mode !== "test" && mode !== "live") {
      return jsonError(400, 'Invalid mode. Expected "test" or "live".');
    }

    let normalizedUrl: string;
    try {
      const url = new URL(rawUrl);
      normalizedUrl = url.toString();
    } catch (error) {
      return jsonError(400, "Invalid eflUrl", {
        message: error instanceof Error ? error.message : String(error),
      });
    }

    const fetched = await fetchEflPdfFromUrl(normalizedUrl);
    if (!fetched.ok) {
      return jsonError(502, "Failed to fetch EFL PDF", {
        message: fetched.error,
        notes: fetched.notes,
      });
    }

    const contentType = fetched.contentType;
    const contentLength = fetched.pdfBytes.length;

    const warnings: string[] = [];
    if (fetched.source === "HTML_RESOLVED") {
      warnings.push(
        "EFL URL resolved via landing page (HTML) → Electricity Facts Label PDF link.",
      );
    }

    const pdfBytes = Buffer.from(fetched.pdfBytes);
    const pdfSha256 = computePdfSha256(pdfBytes);

    const steps: string[] = ["downloaded_pdf", "computed_sha256"];

    let cleanedText: string | undefined;
    let planRules: unknown;
    let rateStructure: unknown;
    let parseConfidence: number | undefined;
    let parseWarnings: string[] | undefined;
    let validation: unknown;
    let eflVersionCode: string | null = null;
    let extractorMethod: "pdf-parse" | "pdfjs" | "pdftotext" | "vision" =
      "pdf-parse";

    try {
      // Deterministic extract: PDF bytes → cleaned text + identity metadata,
      // now with internal pdf-parse → pdfjs-dist fallback.
      const extract = await deterministicEflExtract(pdfBytes);

      cleanedText = extract.rawText;
      eflVersionCode = extract.eflVersionCode ?? null;
      if (extract.warnings && extract.warnings.length > 0) {
        warnings.push(...extract.warnings);
      }
      if (extract.extractorMethod) {
        extractorMethod = extract.extractorMethod;
      }

      if (cleanedText && cleanedText.trim().length > 0) {
        // Text-based AI extraction path
        const aiResult = await extractPlanRulesAndRateStructureFromEflText({
          input: {
            rawText: extract.rawText,
            repPuctCertificate: extract.repPuctCertificate,
            eflVersionCode: extract.eflVersionCode,
            eflPdfSha256: extract.eflPdfSha256,
            warnings: extract.warnings,
          },
        });

        planRules = aiResult.planRules ?? null;
        rateStructure = aiResult.rateStructure ?? null;
        parseConfidence = aiResult.meta.parseConfidence;
        parseWarnings = aiResult.meta.parseWarnings;
        validation = aiResult.meta.validation ?? null;

        steps.push("deterministic_extract", "ai_planrules_extract");
      } else {
        // Vision-based AI fallback: no usable text from pdf-parse/pdfjs
        const visionResult =
          await extractPlanRulesAndRateStructureFromEflUrlVision({
            eflUrl: normalizedUrl,
            inputMeta: {
              rawText: "",
              repPuctCertificate: extract.repPuctCertificate,
              eflVersionCode: extract.eflVersionCode,
              eflPdfSha256: extract.eflPdfSha256,
              warnings: extract.warnings,
            },
          });

        planRules = visionResult.planRules ?? null;
        rateStructure = visionResult.rateStructure ?? null;
        parseConfidence = visionResult.meta.parseConfidence;
        parseWarnings = visionResult.meta.parseWarnings;
        validation = visionResult.meta.validation ?? null;

        steps.push("deterministic_extract", "ai_planrules_vision_fallback");
        extractorMethod = "vision";
      }
    } catch (error) {
      warnings.push(
        `AI extraction failed: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }

    // Human-readable mode notes for the admin response.
    const notes =
      mode === "test"
        ? "Test mode: downloads/fingerprints the EFL PDF and (best-effort) runs AI extraction; no persistence."
        : "Live mode: best-effort persistence into RatePlan with EFL guardrails; incomplete plans are marked for manual review.";

    // Live-mode persistence with guardrails. Test mode remains read-only.
    if (mode === "live" && planRules && pdfSha256) {
      try {
        const saved = await upsertRatePlanFromEfl({
          mode,
          eflUrl: normalizedUrl,
          repPuctCertificate:
            (validation as any)?.repPuctCertificate ?? null,
          eflVersionCode: (validation as any)?.eflVersionCode ?? null,
          eflPdfSha256: pdfSha256,
          providerName: (planRules as any)?.repName ?? null,
          planName: (planRules as any)?.planMarketingName ?? null,
          termMonths:
            typeof (planRules as any)?.termMonths === "number"
              ? (planRules as any).termMonths
              : null,
          planRules: planRules as any,
          rateStructure: rateStructure as any,
          validation: validation as any,
        });
        steps.push(
          (saved as any)?.templatePersisted ? "rateplan_template_persisted" : "rateplan_saved_manual_review",
        );
      } catch (persistError) {
        warnings.push(
          `EFL live persistence failed: ${
            persistError instanceof Error
              ? persistError.message
              : String(persistError)
          }`,
        );
      }
    }

    const payload: RunLinkSuccess = {
      ok: true,
      mode,
      eflUrl: normalizedUrl,
      steps,
      pdfSha256,
      contentType,
      contentLength,
      warnings,
      notes,
      cleanedText,
      planRules,
      rateStructure,
      parseConfidence,
      parseWarnings,
      eflVersionCode,
      extractorMethod,
    };

    return NextResponse.json(payload, { status: 200 });
  } catch (error) {
    return jsonError(500, "Unexpected error in /api/admin/efl/run-link", {
      message: error instanceof Error ? error.message : String(error),
    });
  }
}

