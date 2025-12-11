import { NextRequest, NextResponse } from "next/server";
import { Buffer } from "node:buffer";

import { deterministicEflExtract } from "@/lib/efl/eflExtractor";
import { buildPlanRulesExtractionPrompt } from "@/lib/efl/aiExtraction";
import { extractPlanRulesAndRateStructureFromEflText } from "@/lib/efl/planAiExtractor";

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

    // Best-effort AI extraction so the admin can see which endpoint fields
    // would be populated from this EFL text without having to read code.
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
        "[EFL_MANUAL_TEXT] AI PlanRules extraction failed; continuing with deterministic preview only",
        err,
      );
      if (Array.isArray(extract.warnings)) {
        extract.warnings.push(
          err instanceof Error
            ? `AI PlanRules extract failed: ${err.message}`
            : "AI PlanRules extract failed.",
        );
      }
    }

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
      planRules,
      rateStructure,
      parseConfidence,
      parseWarnings,
      validation,
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


