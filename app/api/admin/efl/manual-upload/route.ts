import { NextRequest, NextResponse } from "next/server";
import { Buffer } from "node:buffer";

import { deterministicEflExtract } from "@/lib/efl/eflExtractor";
import { parseEflPdfWithAi } from "@/lib/efl/eflAiParser";

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

    // Deterministic extract: PDF bytes → cleaned text + identity metadata
    // (SHA-256, PUCT certificate, EFL Ver. #, extractor warnings).
    const extract = await deterministicEflExtract(pdfBuffer);

    const rawText = extract.rawText ?? "";
    const rawTextTruncated = rawText.length > MAX_PREVIEW_CHARS;
    const rawTextPreview = rawTextTruncated
      ? rawText.slice(0, MAX_PREVIEW_CHARS)
      : rawText;

    const {
      eflPdfSha256,
      repPuctCertificate,
      eflVersionCode,
      warnings: deterministicWarnings,
      extractorMethod,
    } = extract;

    // Always call the AI PDF parser on the original PDF bytes, regardless of
    // rawText content. Text extraction is now diagnostic only.
    const aiResult = await parseEflPdfWithAi({
      pdfBytes: pdfBuffer,
      eflPdfSha256,
      rawText,
    });

    const allWarnings = [
      ...(deterministicWarnings ?? []),
      ...(aiResult.parseWarnings ?? []),
    ];

    return NextResponse.json({
      ok: true,
      eflPdfSha256,
      repPuctCertificate,
      eflVersionCode,
      warnings: allWarnings,
      // Prompt is now a simple descriptor since the AI runs directly on the PDF.
      prompt:
        "EFL PDF parsed by OpenAI using the standard planRules/rateStructure contract.",
      rawTextPreview,
      rawTextLength: rawText.length,
      rawTextTruncated,
      planRules: aiResult.planRules,
      rateStructure: aiResult.rateStructure,
      parseConfidence: aiResult.parseConfidence,
      parseWarnings: aiResult.parseWarnings,
      validation: null,
      extractorMethod: extractorMethod ?? "pdf-parse",
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

