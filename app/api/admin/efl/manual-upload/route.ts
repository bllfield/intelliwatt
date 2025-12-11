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

    // Reuse the same deterministic extractor wiring and centralized PDF
    // text fallback (pdf-parse → pdfjs) as the /api/admin/efl/run-link
    // endpoint so behavior is consistent between manual uploads and
    // URL-based runs.
    const extract = await deterministicEflExtract(pdfBuffer);

    const rawText = extract.rawText ?? "";

    // Heuristic: if the "text" we got back still looks like raw PDF bytes
    // (e.g. starts with %PDF- and/or has a very low ratio of printable
    // characters), treat this as a hard text-extraction failure instead of
    // feeding binary junk into the AI parser.
    const looksLikePdfHeader = rawText.startsWith("%PDF-");
    let printableRatio = 1;
    if (rawText.length > 0) {
      let printableCount = 0;
      for (let i = 0; i < rawText.length; i++) {
        const code = rawText.charCodeAt(i);
        // Treat ASCII whitespace + visible ASCII as "printable".
        const isPrintable =
          code === 9 || code === 10 || code === 13 || (code >= 32 && code <= 126);
        if (isPrintable) {
          printableCount++;
        }
      }
      printableRatio = printableCount / rawText.length;
    }

    const looksBinaryOrCorrupt = looksLikePdfHeader || printableRatio < 0.4;

    if (looksBinaryOrCorrupt) {
      extract.warnings.push(
        "PDF text extraction appears to have failed (content looks binary or non-text). " +
          "This EFL cannot be parsed automatically; please paste the EFL text using the Manual Text tab.",
      );
    }

    const prompt = buildPlanRulesExtractionPrompt({
      rawText: looksBinaryOrCorrupt
        ? "[[PDF text extraction failed; content appears to be binary or unsupported. No readable EFL text is available.]]"
        : rawText,
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

    if (!looksBinaryOrCorrupt) {
      try {
        const aiResult = await extractPlanRulesAndRateStructureFromEflText({
          input: {
            rawText,
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
        // Surface a user-visible warning
        if (Array.isArray(extract.warnings)) {
          extract.warnings.push(
            err instanceof Error
              ? `AI PlanRules extract failed: ${err.message}`
              : "AI PlanRules extract failed.",
          );
        }
      }
    } else {
      // Binary/corrupt text: don't even call the AI, just surface a clear failure.
      parseConfidence = 0;
      parseWarnings = [
        "Skipped AI PlanRules extract because PDF text extraction failed and produced non-text/binary content.",
      ];
      validation = null;
    }

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
      extractorMethod: extract.extractorMethod ?? "pdf-parse",
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

