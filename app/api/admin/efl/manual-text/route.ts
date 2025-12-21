import { NextRequest, NextResponse } from "next/server";
import { runEflPipeline } from "@/lib/efl/runEflPipeline";
import { adminUsageAuditForHome } from "@/lib/usage/adminUsageAudit";

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

    const usageRequested = req.nextUrl.searchParams.get("usage") === "1";
    const usageEmail = String(req.nextUrl.searchParams.get("usageEmail") ?? "").trim();
    const usageMonths = Number(req.nextUrl.searchParams.get("usageMonths") ?? "12") || 12;
    const canWriteUsage = Boolean(usageRequested && adminToken && headerToken === adminToken);

    const pipelineResult = await runEflPipeline({
      source: "manual_text",
      actor: "admin",
      dryRun: !canPersist,
      rawText: raw,
    });

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
      prompt: "EFL text parsed by OpenAI using the standard planRules/rateStructure contract.",
      rawTextPreview: String(pipelineResult.rawTextPreview ?? "").slice(0, MAX_PREVIEW_CHARS),
      rawTextLength: pipelineResult.rawTextLen ?? raw.length,
      rawTextTruncated: pipelineResult.rawTextTruncated ?? raw.length > MAX_PREVIEW_CHARS,
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
      extractorMethod: pipelineResult.extractorMethod ?? "raw_text",
      dryRun: !canPersist,
      persistedRatePlanId: pipelineResult.ratePlanId ?? null,
      usageAudit,
      pipelineResult,
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


