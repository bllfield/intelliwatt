import { NextRequest, NextResponse } from "next/server";
import { Buffer } from "node:buffer";

import { deterministicEflExtract } from "@/lib/efl/eflExtractor";
import { buildPlanRulesExtractionPrompt } from "@/lib/efl/aiExtraction";
import { extractPlanRulesAndRateStructureFromEflText } from "@/lib/efl/planAiExtractor";
import { runEflPipeline } from "@/lib/efl/runEflPipeline";

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

    // Canonical pipeline. Defaults to preview-only unless `persist=1` AND admin token.
    const persistRequested = req.nextUrl.searchParams.get("persist") === "1";
    const adminToken = process.env.ADMIN_TOKEN ?? null;
    const headerToken = req.headers.get("x-admin-token");
    const canPersist = Boolean(persistRequested && adminToken && headerToken === adminToken);

    const pipelineResult = await runEflPipeline({
      source: "manual_text",
      actor: "admin",
      dryRun: !canPersist,
      rawText: raw,
    });

    return NextResponse.json({
      ok: true,
      eflPdfSha256: pipelineResult.eflPdfSha256 ?? null,
      repPuctCertificate: pipelineResult.repPuctCertificate ?? null,
      eflVersionCode: pipelineResult.eflVersionCode ?? null,
      warnings: pipelineResult.deterministicWarnings ?? [],
      prompt: "EFL text parsed by OpenAI using the standard planRules/rateStructure contract.",
      rawTextPreview: String(pipelineResult.rawTextPreview ?? "").slice(0, MAX_PREVIEW_CHARS),
      rawTextLength: Number(pipelineResult.rawTextLen ?? 0) || raw.length,
      rawTextTruncated: Boolean(pipelineResult.rawTextTruncated ?? raw.length > MAX_PREVIEW_CHARS),
      planRules: pipelineResult.planRules ?? null,
      rateStructure: pipelineResult.rateStructure ?? null,
      parseConfidence: pipelineResult.parseConfidence ?? null,
      parseWarnings: pipelineResult.parseWarnings ?? [],
      validation: pipelineResult.validation ?? null,
      derivedForValidation: pipelineResult.derivedForValidation ?? null,
      extractorMethod: pipelineResult.extractorMethod ?? "raw_text",
      dryRun: !canPersist,
      persistedRatePlanId: pipelineResult.ratePlanId ?? null,
      pipelineResult,
    });

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
    } catch (err: unknown) {
      // eslint-disable-next-line no-console
      console.error(
        "[EFL_MANUAL_TEXT] AI PlanRules extraction failed; continuing with deterministic preview only",
        err,
      );
      if (Array.isArray(extract.warnings)) {
        const e = err as any;
        const msg =
          e instanceof Error ? `AI PlanRules extract failed: ${String(e.message ?? "")}` : "AI PlanRules extract failed.";
        extract.warnings.push(
          msg,
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


