import { NextRequest, NextResponse } from "next/server";
import { Buffer } from "node:buffer";

import { runEflPipeline } from "@/lib/efl/runEflPipeline";
import { adminUsageAuditForHome } from "@/lib/usage/adminUsageAudit";

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

    // Canonical pipeline (single source of truth). This route defaults to preview-only unless
    // explicitly requested with `persist=1` AND an admin token.
    const persistRequested = req.nextUrl.searchParams.get("persist") === "1";
    const adminToken = process.env.ADMIN_TOKEN ?? null;
    const headerToken = req.headers.get("x-admin-token");
    const canPersist = Boolean(persistRequested && adminToken && headerToken === adminToken);

    const usageRequested = req.nextUrl.searchParams.get("usage") === "1";
    const usageEmail = String(req.nextUrl.searchParams.get("usageEmail") ?? "").trim();
    const usageMonths = Number(req.nextUrl.searchParams.get("usageMonths") ?? "12") || 12;
    const canWriteUsage = Boolean(usageRequested && adminToken && headerToken === adminToken);

    const pipelineResult = await runEflPipeline({
      source: "manual_upload",
      actor: "admin",
      dryRun: !canPersist,
      pdfBytes: pdfBuffer,
    });

    const rawTextPreview = String(pipelineResult.rawTextPreview ?? "").slice(0, MAX_PREVIEW_CHARS);
    // If rawTextLen is unavailable, do NOT pretend the preview length is the full length.
    // Use a conservative lower bound instead; callers can rely on `rawTextTruncated` + `rawTextLengthIsExact`.
    const rawTextLength = pipelineResult.rawTextLen ?? (pipelineResult.rawTextTruncated ? MAX_PREVIEW_CHARS : rawTextPreview.length);
    const rawTextTruncated = Boolean(pipelineResult.rawTextTruncated ?? false);

    const aiEnabled = process.env.OPENAI_IntelliWatt_Fact_Card_Parser === "1";
    const hasKey =
      !!process.env.OPENAI_API_KEY &&
      process.env.OPENAI_API_KEY.trim().length > 0;

    let usageAudit: any | null = null;
    if (usageRequested) {
      if (!canWriteUsage) {
        usageAudit = {
          ok: false,
          usageContext: {
            email: String(usageEmail || "").trim().toLowerCase(),
            homeId: null,
            esiid: null,
            months: Math.max(1, Math.min(24, usageMonths)),
            bucketKeys: [],
            computed: null,
            errors: ["unauthorized_or_missing_token"],
          },
          usagePreview: null,
          usageEstimate: null,
        };
      } else if (usageEmail) {
        usageAudit = await adminUsageAuditForHome({
          usageEmail,
          usageMonths,
          requiredBucketKeys: Array.isArray(pipelineResult.requiredBucketKeys)
            ? pipelineResult.requiredBucketKeys
            : [],
          rateStructure: pipelineResult.rateStructure ?? null,
          tdspSlug: null,
        });
      } else {
        usageAudit = {
          ok: false,
          usageContext: {
            email: "",
            homeId: null,
            esiid: null,
            months: Math.max(1, Math.min(24, usageMonths)),
            bucketKeys: [],
            computed: null,
            errors: ["missing_usageEmail"],
          },
          usagePreview: null,
          usageEstimate: null,
        };
      }
    }

    return NextResponse.json({
      ok: true,
      eflPdfSha256: pipelineResult.eflPdfSha256 ?? null,
      repPuctCertificate: pipelineResult.repPuctCertificate ?? null,
      eflVersionCode: pipelineResult.eflVersionCode ?? null,
      warnings: pipelineResult.deterministicWarnings ?? [],
      // Prompt is now a simple descriptor since the AI runs directly on the EFL text.
      prompt:
        "EFL PDF parsed by OpenAI using the standard planRules/rateStructure contract.",
      rawTextPreview,
      rawTextLength,
      rawTextLengthIsExact: pipelineResult.rawTextLen != null,
      rawTextTruncated,
      planRules: pipelineResult.planRules ?? null,
      rateStructure: pipelineResult.rateStructure ?? null,
      parseConfidence: pipelineResult.parseConfidence ?? null,
      parseWarnings: pipelineResult.parseWarnings ?? [],
      validation: pipelineResult.validation ?? null,
      derivedForValidation: pipelineResult.derivedForValidation ?? null,
      finalValidation: pipelineResult.finalValidation ?? null,
      passStrength: pipelineResult.passStrength ?? null,
      passStrengthReasons: pipelineResult.passStrengthReasons ?? [],
      passStrengthOffPointDiffs: pipelineResult.passStrengthOffPointDiffs ?? null,
      queued: Boolean(pipelineResult.queued),
      queueReason: pipelineResult.queueReason ?? null,
      planCalcStatus: pipelineResult.planCalcStatus ?? "UNKNOWN",
      planCalcReasonCode: String(pipelineResult.planCalcReasonCode ?? "UNKNOWN"),
      requiredBucketKeys: Array.isArray(pipelineResult.requiredBucketKeys)
        ? pipelineResult.requiredBucketKeys
        : [],
      extractorMethod: pipelineResult.extractorMethod ?? "pdftotext",
      ai: {
        enabled: aiEnabled,
        hasKey,
        used: aiEnabled && hasKey,
      },
      dryRun: !canPersist,
      persistedRatePlanId: pipelineResult.ratePlanId ?? null,
      usageAudit,
      pipelineResult,
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

