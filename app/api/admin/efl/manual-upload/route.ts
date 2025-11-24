import { NextRequest, NextResponse } from "next/server";
import { deterministicEflExtract } from "@/lib/efl/eflExtractor";
import { buildPlanRulesExtractionPrompt } from "@/lib/efl/aiExtraction";

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

    const pdfModule = await import("pdf-parse");
    const pdfParse = (pdfModule as any).default ?? pdfModule;
    const parsedPdf = (await pdfParse(pdfBuffer)) as { text?: string };
    const normalizedText = (parsedPdf.text ?? "").trim();

    const extract = await deterministicEflExtract(
      pdfBuffer,
      async () => normalizedText,
    );

    const prompt = buildPlanRulesExtractionPrompt({
      rawText: extract.rawText,
      repPuctCertificate: extract.repPuctCertificate,
      eflVersionCode: extract.eflVersionCode,
      eflPdfSha256: extract.eflPdfSha256,
      warnings: extract.warnings,
    });

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
    });
  } catch (error) {
    console.error("[EFL_MANUAL_UPLOAD] Failed to process fact card:", error);
    return NextResponse.json(
      {
        ok: false,
        error:
          "We couldn't process that PDF. Please confirm it is a valid EFL and try again.",
      },
      { status: 500 },
    );
  }
}

