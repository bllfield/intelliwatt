import { NextRequest, NextResponse } from "next/server";
import { Buffer } from "node:buffer";

import { deterministicEflExtract } from "@/lib/efl/eflExtractor";
import { buildPlanRulesExtractionPrompt } from "@/lib/efl/aiExtraction";

const MAX_PREVIEW_CHARS = 20000;

export const dynamic = "force-dynamic";

type ManualTextBody = {
  rawText?: string;
};

export async function POST(req: NextRequest) {
  try {
    let body: ManualTextBody;
    try {
      body = (await req.json()) as ManualTextBody;
    } catch {
      return NextResponse.json(
        { ok: false, error: "Invalid JSON body." },
        { status: 400 },
      );
    }

    const raw = (body.rawText ?? "").trim();
    if (!raw) {
      return NextResponse.json(
        { ok: false, error: "rawText is required and must be non-empty." },
        { status: 400 },
      );
    }

    // For manual text, we treat the UTF-8 bytes of the text as the "PDF bytes"
    // for purposes of computing a stable fingerprint. No actual PDF parsing
    // is required; the caller has already provided normalized text.
    const textBytes = Buffer.from(raw, "utf8");

    const extract = await deterministicEflExtract(
      textBytes,
      async () => raw,
    );

    const prompt = buildPlanRulesExtractionPrompt({
      rawText: extract.rawText,
      repPuctCertificate: extract.repPuctCertificate,
      eflVersionCode: extract.eflVersionCode,
      eflPdfSha256: extract.eflPdfSha256,
      warnings: extract.warnings,
    });

    const fullText = extract.rawText ?? "";
    const rawTextTruncated = fullText.length > MAX_PREVIEW_CHARS;
    const rawTextPreview = rawTextTruncated
      ? fullText.slice(0, MAX_PREVIEW_CHARS)
      : fullText;

    return NextResponse.json({
      ok: true,
      eflPdfSha256: extract.eflPdfSha256,
      repPuctCertificate: extract.repPuctCertificate,
      eflVersionCode: extract.eflVersionCode,
      warnings: extract.warnings,
      prompt,
      rawTextPreview,
      rawTextLength: fullText.length,
      rawTextTruncated,
    });
  } catch (error) {
    console.error("[EFL_MANUAL_TEXT] Failed to process pasted EFL text:", error);
    return NextResponse.json(
      {
        ok: false,
        error:
          "We couldn't process that text. Please confirm it is valid EFL content and try again.",
      },
      { status: 500 },
    );
  }
}


