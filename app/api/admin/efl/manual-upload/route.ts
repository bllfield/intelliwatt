import { NextRequest, NextResponse } from "next/server";
import { Buffer } from "node:buffer";

import { getOrCreateEflTemplate } from "@/lib/efl/getOrCreateEflTemplate";

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

    const aiEnabled = process.env.OPENAI_IntelliWatt_Fact_Card_Parser === "1";
    const hasKey =
      !!process.env.OPENAI_API_KEY &&
      process.env.OPENAI_API_KEY.trim().length > 0;

    const { template, warnings: topWarnings } = await getOrCreateEflTemplate({
      source: "manual_upload",
      pdfBytes: pdfBuffer,
      filename: (file as File).name ?? null,
    });

    const rawText = template.rawText ?? "";
    const rawTextTruncated = rawText.length > MAX_PREVIEW_CHARS;
    const rawTextPreview = rawTextTruncated
      ? rawText.slice(0, MAX_PREVIEW_CHARS)
      : rawText;

    const aiUsed =
      aiEnabled &&
      hasKey &&
      !Array.isArray(template.parseWarnings) ? false :
      !(
        (template.parseWarnings ?? []).some((w: string) =>
          w.includes("AI_DISABLED_OR_MISSING_KEY"),
        )
      );

    const ai: {
      enabled: boolean;
      hasKey: boolean;
      used: boolean;
      reason?: string;
    } = {
      enabled: aiEnabled,
      hasKey,
      used: aiUsed,
    };

    if (!aiUsed) {
      ai.reason = !aiEnabled
        ? "AI disabled via OPENAI_IntelliWatt_Fact_Card_Parser flag."
        : !hasKey
          ? "OPENAI_API_KEY is missing or empty."
          : "AI parser skipped; see parseWarnings for details.";
    }

    return NextResponse.json({
      ok: true,
      eflPdfSha256: template.eflPdfSha256,
      repPuctCertificate: template.repPuctCertificate,
      eflVersionCode: template.eflVersionCode,
      warnings: topWarnings,
      // Prompt is now a simple descriptor since the AI runs directly on the EFL text.
      prompt:
        "EFL PDF parsed by OpenAI using the standard planRules/rateStructure contract.",
      rawTextPreview,
      rawTextLength: rawText.length,
      rawTextTruncated,
      planRules: template.planRules,
      rateStructure: template.rateStructure,
      parseConfidence: template.parseConfidence,
      parseWarnings: template.parseWarnings,
      validation: template.validation ?? null,
      extractorMethod: template.extractorMethod ?? "pdftotext",
      ai,
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
        error: {
          message,
          code: "EFL_MANUAL_UPLOAD_ERROR",
        },
      },
      { status: 500 },
    );
  }
}

