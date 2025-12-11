import { NextRequest, NextResponse } from "next/server";
import { Buffer } from "node:buffer";

import { computePdfSha256, deterministicEflExtract } from "@/lib/efl/eflExtractor";
import { extractPlanRulesAndRateStructureFromEflText } from "@/lib/efl/planAiExtractor";
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

    let res: Response;
    try {
      res = await fetch(normalizedUrl);
    } catch (error) {
      return jsonError(502, "Failed to fetch EFL PDF", {
        message: error instanceof Error ? error.message : String(error),
      });
    }

    if (!res.ok) {
      return jsonError(res.status, "EFL PDF fetch returned non-OK status", {
        status: res.status,
        statusText: res.statusText,
      });
    }

    const contentType = res.headers.get("content-type");
    const contentLengthHeader = res.headers.get("content-length");
    const parsedContentLength = contentLengthHeader
      ? Number(contentLengthHeader)
      : null;
    const contentLength = Number.isFinite(parsedContentLength)
      ? parsedContentLength
      : null;

    const warnings: string[] = [];
    if (contentType && !contentType.toLowerCase().includes("pdf")) {
      warnings.push(
        `Content-Type is ${contentType}, which does not look like a PDF.`,
      );
    }

    const arrayBuffer = await res.arrayBuffer();
    const pdfBytes = Buffer.from(arrayBuffer);
    const pdfSha256 = computePdfSha256(pdfBytes);

    const steps: string[] = ["downloaded_pdf", "computed_sha256"];

    let cleanedText: string | undefined;
    let planRules: unknown;
    let rateStructure: unknown;
    let parseConfidence: number | undefined;
    let parseWarnings: string[] | undefined;
    let validation: unknown;
    let eflVersionCode: string | null = null;

    try {
      // Deterministic extract: PDF bytes → cleaned text + identity metadata
      const extract = await deterministicEflExtract(pdfBytes, async (bytes) => {
        const pdfParseModule = await import("pdf-parse");
        const pdfParseFn: any =
          (pdfParseModule as any).default || (pdfParseModule as any);
        const result = await pdfParseFn(Buffer.from(bytes));
        return result?.text || "";
      });

      cleanedText = extract.rawText;
      eflVersionCode = extract.eflVersionCode ?? null;

      // AI extraction: EFL text → PlanRules + RateStructure
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
        await upsertRatePlanFromEfl({
          mode,
          eflUrl: normalizedUrl,
          repPuctCertificate:
            (validation as any)?.repPuctCertificate ?? null,
          eflVersionCode: (validation as any)?.eflVersionCode ?? null,
          eflPdfSha256: pdfSha256,
          providerName: (planRules as any)?.repName ?? null,
          planName: (planRules as any)?.planMarketingName ?? null,
          planRules: planRules as any,
          rateStructure: rateStructure as any,
          validation: validation as any,
        });
        steps.push("rateplan_persisted");
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
    };

    return NextResponse.json(payload, { status: 200 });
  } catch (error) {
    return jsonError(500, "Unexpected error in /api/admin/efl/run-link", {
      message: error instanceof Error ? error.message : String(error),
    });
  }
}

