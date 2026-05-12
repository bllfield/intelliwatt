import { NextRequest, NextResponse } from "next/server";
import { Buffer } from "node:buffer";

import { fetchEflSourceFromUrl } from "@/lib/efl/fetchEflPdf";
import { runEflPipeline } from "@/lib/plan-engine-next/efl/runEflPipeline";
import { prisma } from "@/lib/db";
import { adminUsageAuditForHome } from "@/lib/usage/adminUsageAudit";
import { adminPersistCurrentPlanFromEflPipeline } from "@/lib/current-plan/adminPersistCurrentPlanFromEflPipeline";
import { autoResolveCurrentPlanQueue } from "@/lib/current-plan/autoResolveCurrentPlanQueue";

const MAX_PREVIEW_CHARS = 20000;

export const dynamic = "force-dynamic";

type ManualUrlBody = {
  eflUrl?: string;
  forceReparse?: boolean;
  overridePdfUrl?: string;
  offerId?: string;
  target?: "offers" | "current_plan";
  persistTemplate?: boolean;
  computeUsageBuckets?: boolean;
  usageEmail?: string;
  usageMonths?: number;
};

export async function POST(req: NextRequest) {
  try {
    let body: ManualUrlBody;
    try {
      body = (await req.json()) as ManualUrlBody;
    } catch {
      return NextResponse.json({ ok: false, error: "Invalid JSON body." }, { status: 400 });
    }

    const eflUrlRaw = (body.eflUrl ?? "").trim();
    if (!eflUrlRaw) {
      return NextResponse.json({ ok: false, error: "eflUrl is required." }, { status: 400 });
    }

    // Normalize URL
    let eflUrl: string;
    try {
      eflUrl = new URL(eflUrlRaw).toString();
    } catch {
      return NextResponse.json({ ok: false, error: "Invalid eflUrl." }, { status: 400 });
    }

    const forceReparse = body.forceReparse === true;

    const target: "offers" | "current_plan" = body.target === "current_plan" ? "current_plan" : "offers";

    const offerId = (body.offerId ?? "").trim() || null;
    const overridePdfUrlRaw = (body.overridePdfUrl ?? "").trim();
    let overridePdfUrl: string | null = null;
    if (overridePdfUrlRaw) {
      try {
        overridePdfUrl = new URL(overridePdfUrlRaw).toString();
      } catch {
        return NextResponse.json({ ok: false, error: "Invalid overridePdfUrl." }, { status: 400 });
      }
    }

    // If an override is provided, treat it as the authoritative PDF location and
    // treat eflUrl as the source URL (e.g., WattBuy enrollment link).
    const pdfFetchUrl = overridePdfUrl ?? eflUrl;
    const effectiveEflUrl = overridePdfUrl ?? eflUrl;
    const eflSourceUrl = eflUrl;

    const fetched = await fetchEflSourceFromUrl(pdfFetchUrl);
    if (!fetched.ok) {
      return NextResponse.json(
        {
          ok: false,
          error: `Failed to fetch EFL PDF: ${fetched.error}`,
          details: {
            eflUrl,
            overridePdfUrl,
            pdfFetchUrl,
            // Include fetcher notes to diagnose WAF/TLS/CORS-style blocking.
            notes: fetched.notes ?? [],
            tip:
              "If this host blocks server-side fetch (common WAF 403), use the Override EFL PDF URL field with a direct PDF link, or upload the PDF in the Upload tab.",
          },
        },
        { status: 502 },
      );
    }

    // Persist gating (admin-only). We do NOT allow writes without a valid admin token.
    const adminToken = process.env.ADMIN_TOKEN ?? null;
    const headerToken = req.headers.get("x-admin-token");
    const canAdminWrite = Boolean(adminToken && headerToken === adminToken);

    const persistRequested = body.persistTemplate === true;
    const canPersistOffers = Boolean(persistRequested && canAdminWrite && target === "offers");
    const canPersistCurrentPlan = Boolean(persistRequested && canAdminWrite && target === "current_plan");

    const pipelineResult = await runEflPipeline({
      source: "manual_url",
      actor: "admin",
      dryRun: !(target === "offers" && canPersistOffers),
      offerId: target === "offers" ? offerId : null,
      eflUrl: effectiveEflUrl,
      eflSourceUrl,
      ...(fetched.kind === "pdf"
        ? { pdfBytes: Buffer.from(fetched.pdfBytes) }
        : { rawText: fetched.rawText }),
    });

    const aiEnabled = process.env.OPENAI_IntelliWatt_Fact_Card_Parser === "1";
    const hasKey = Boolean(process.env.OPENAI_API_KEY && process.env.OPENAI_API_KEY.trim().length > 0);

    const usageRequested = body.computeUsageBuckets === true;
    const usageEmail = String(body.usageEmail ?? "").trim();
    const usageMonths = Number(body.usageMonths ?? 12) || 12;
    const canWriteUsage = Boolean(usageRequested && canAdminWrite);

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
          rawTextForTdspInference: String(pipelineResult.rawTextPreview ?? ""),
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

    const persistedRatePlanId =
      target === "offers" && canPersistOffers && !pipelineResult.queued
        ? String((pipelineResult as any)?.ratePlanId ?? "").trim() || null
        : null;

    // Current-plan persistence (module DB). Requires usageEmail to select the home.
    let currentPlanPersist: any | null = null;
    if (canPersistCurrentPlan) {
      if (!usageEmail) {
        currentPlanPersist = { ok: false, error: "missing_usageEmail" };
      } else {
        const usageHomeId = (usageAudit as any)?.usageContext?.homeId ?? null;
        currentPlanPersist = await adminPersistCurrentPlanFromEflPipeline({
          usageEmail,
          usageHomeId,
          pipelineResult,
        });
      }
    }

    // Auto-resolve matching OPEN queue rows when we successfully persisted a template.
    let autoResolvedQueueCount = 0;
    const shouldAutoResolve =
      (target === "offers" && persistedRatePlanId && !pipelineResult.queued) ||
      (target === "current_plan" && currentPlanPersist?.ok);
    if (shouldAutoResolve) {
      try {
        const now = new Date();
        const sha = String(pipelineResult.eflPdfSha256 ?? "").trim();
        const rep = String(pipelineResult.repPuctCertificate ?? "").trim();
        const ver = String(pipelineResult.eflVersionCode ?? "").trim();
        const whereOr = [
          sha ? { eflPdfSha256: sha } : undefined,
          target === "offers" && offerId ? { offerId: String(offerId) } : undefined,
          rep && ver ? { repPuctCertificate: rep, eflVersionCode: ver } : undefined,
        ].filter(Boolean);
        if (whereOr.length > 0) {
          if (target === "current_plan") {
            const resolved = await autoResolveCurrentPlanQueue({
              sourceMode: "all_current_plan",
              eflPdfSha256: pipelineResult.eflPdfSha256 ?? null,
              repPuctCertificate: pipelineResult.repPuctCertificate ?? null,
              eflVersionCode: pipelineResult.eflVersionCode ?? null,
              providerName: currentPlanPersist?.providerName ?? null,
              planName: currentPlanPersist?.planName ?? null,
              termMonths:
                typeof pipelineResult?.planRules?.termMonths === "number"
                  ? pipelineResult.planRules.termMonths
                  : null,
              userEmail: usageEmail,
              resolvedBy: "fact_cards_current_plan",
              resolutionNotes: `AUTO_RESOLVED: current-plan template persisted via Fact Cards. parsedCurrentPlanId=${currentPlanPersist?.parsedCurrentPlanId ?? "—"}`,
            });
            autoResolvedQueueCount = resolved.count;
          } else {
            const upd = await (prisma as any).eflParseReviewQueue.updateMany({
              where: {
                resolvedAt: null,
                OR: whereOr,
              },
              data: {
                resolvedAt: now,
                resolvedBy: "manual_url",
                resolutionNotes: `AUTO_RESOLVED: template persisted via Fact Cards. ratePlanId=${persistedRatePlanId ?? "—"}`,
              },
            });
            autoResolvedQueueCount = Number(upd?.count ?? 0) || 0;
          }
        }
      } catch {
        autoResolvedQueueCount = 0;
      }
    }

    const currentPlanResolved = target === "current_plan" && Boolean(currentPlanPersist?.ok);
    const effectiveQueued = currentPlanResolved ? false : Boolean(pipelineResult.queued);
    const effectiveQueueReason = currentPlanResolved ? null : (pipelineResult.queueReason ?? null);

    return NextResponse.json({
      ok: true,
      build: {
        vercelGitCommitSha: process.env.VERCEL_GIT_COMMIT_SHA ?? null,
        vercelEnv: process.env.VERCEL_ENV ?? null,
      },
      eflUrl: effectiveEflUrl,
      eflSourceUrl,
      offerId,
      eflPdfSha256: pipelineResult.eflPdfSha256 ?? null,
      repPuctCertificate: pipelineResult.repPuctCertificate ?? null,
      eflVersionCode: pipelineResult.eflVersionCode ?? null,
      warnings: pipelineResult.deterministicWarnings ?? [],
      prompt: "EFL PDF parsed by OpenAI using the standard planRules/rateStructure contract.",
      rawTextPreview: String(pipelineResult.rawTextPreview ?? "").slice(0, MAX_PREVIEW_CHARS),
      rawTextLength: pipelineResult.rawTextLen ?? 0,
      rawTextTruncated: Boolean(pipelineResult.rawTextTruncated ?? false),
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
      queued: effectiveQueued,
      queueReason: effectiveQueueReason,
      planCalcStatus: pipelineResult.planCalcStatus ?? "UNKNOWN",
      planCalcReasonCode: String(pipelineResult.planCalcReasonCode ?? "UNKNOWN"),
      requiredBucketKeys: Array.isArray(pipelineResult.requiredBucketKeys)
        ? pipelineResult.requiredBucketKeys
        : [],
      templatePersisted: target === "offers" ? Boolean(persistedRatePlanId) : Boolean(currentPlanPersist?.ok),
      persistedRatePlanId: target === "offers" ? (persistedRatePlanId ?? null) : null,
      currentPlanPersist,
      autoResolvedQueueCount,
      persistAttempted: true,
      persistUsedDerived: true,
      persistNotes: currentPlanResolved
        ? `Current-plan template persisted. parsedCurrentPlanId=${currentPlanPersist?.parsedCurrentPlanId ?? "—"}`
        : (pipelineResult.queued ? (pipelineResult.queueReason ?? null) : null),
      extractorMethod: pipelineResult.extractorMethod ?? "pdftotext",
      ai: {
        enabled: aiEnabled,
        hasKey,
        used: aiEnabled && hasKey,
      },
      usageAudit,
      pipelineResult,
    });
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error("[EFL_MANUAL_URL] Failed to process EFL URL:", error);
    const message =
      error instanceof Error ? error.message : "We couldn't process that EFL URL. Please try again.";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}


