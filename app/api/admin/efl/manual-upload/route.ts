import { NextRequest, NextResponse } from "next/server";
import { Buffer } from "node:buffer";

import { deterministicEflExtract } from "@/lib/efl/eflExtractor";
import { buildPlanRulesExtractionPrompt } from "@/lib/efl/aiExtraction";
import { extractPlanRulesAndRateStructureFromEflText } from "@/lib/efl/planAiExtractor";

const MAX_PREVIEW_CHARS = 20000;

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const file = formData.get("file");

    if (!file || !(file instanceof File)) {
      return NextResponse.json(
        { ok: false, error: "A PDF file is required." },
        { status: 400 },
      );
    }

    const arrayBuffer = await file.arrayBuffer();
    const pdfBuffer = Buffer.from(arrayBuffer);

    // Reuse the same deterministic extractor wiring as the /api/admin/efl/run-link
    // endpoint so behavior is consistent between manual uploads and URL-based runs.
    // If pdf-parse fails for any reason, we fall back to a simple UTF-8 decode
    // instead of throwing, so the admin can still see a raw-text preview.
    const extract = await deterministicEflExtract(pdfBuffer, async (bytes) => {
      try {
        const pdfParseModule = await import("pdf-parse");
        const pdfParseFn: any =
          (pdfParseModule as any).default || (pdfParseModule as any);
        const result = await pdfParseFn(Buffer.from(bytes));
        const text = (result?.text ?? "").toString();
        if (typeof text === "string" && text.trim().length > 0) {
          return text;
        }
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error(
          "[EFL_MANUAL_UPLOAD] pdf-parse failed, falling back to UTF-8 decode",
          err,
        );
      }

      return Buffer.from(bytes).toString("utf8");
    });

    const prompt = buildPlanRulesExtractionPrompt({
      rawText: extract.rawText,
      repPuctCertificate: extract.repPuctCertificate,
      eflVersionCode: extract.eflVersionCode,
      eflPdfSha256: extract.eflPdfSha256,
      warnings: extract.warnings,
    });

    // Best-effort AI extraction: mirror /api/admin/efl/run-link so this tool
    // can show how the parser would populate PlanRules + RateStructure and
    // which fields require manual review. Failures are reported as warnings
    // but do not break the deterministic preview.
    let planRules: unknown = null;
    let rateStructure: unknown = null;
    let parseConfidence: number | undefined;
    let parseWarnings: string[] | undefined;
    let validation: unknown;

    try {
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
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error(
        "[EFL_MANUAL_UPLOAD] AI PlanRules extraction failed; continuing with deterministic preview only",
        err,
      );
      // Surface a user-visible warning without failing the request.
      if (Array.isArray(extract.warnings)) {
        extract.warnings.push(
          err instanceof Error
            ? `AI PlanRules extract failed: ${err.message}`
            : "AI PlanRules extract failed.",
        );
      }
    }

    const rawText = extract.rawText ?? "";
    const rawTextTruncated = rawText.length > MAX_PREVIEW_CHARS;
    const rawTextPreview = rawTextTruncated
      ? rawText.slice(0, MAX_PREVIEW_CHARS)
      : rawText;

    return NextResponse.json({
      ok: true,
      eflPdfSha256: extract.eflPdfSha256,
      repPuctCertificate: extract.repPuctCertificate,
      eflVersionCode: extract.eflVersionCode,
      warnings: extract.warnings,
      prompt,
      rawTextPreview,
      rawTextLength: rawText.length,
      rawTextTruncated,
      planRules,
      rateStructure,
      parseConfidence,
      parseWarnings,
      validation,
    });
  } catch (error) {
    console.error("[EFL_MANUAL_UPLOAD] Failed to process fact card:", error);
    const message =
      error instanceof Error
        ? error.message
        : "We couldn't process that PDF. Please confirm it is a valid EFL and try again.";
    return NextResponse.json(
      {
        ok: false,
        error: message,
      },
      { status: 500 },
    );
  }
}

