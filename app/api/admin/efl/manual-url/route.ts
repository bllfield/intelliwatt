import { NextRequest, NextResponse } from "next/server";
import { Buffer } from "node:buffer";

import { fetchEflPdfFromUrl } from "@/lib/efl/fetchEflPdf";
import { getOrCreateEflTemplate } from "@/lib/efl/getOrCreateEflTemplate";
import { upsertRatePlanFromEfl } from "@/lib/efl/planPersistence";
import { validatePlanRules, planRulesToRateStructure } from "@/lib/efl/planEngine";
import { inferTdspTerritoryFromEflText } from "@/lib/efl/eflValidator";
import { solveEflValidationGaps } from "@/lib/efl/validation/solveEflValidationGaps";

const MAX_PREVIEW_CHARS = 20000;

export const dynamic = "force-dynamic";

type ManualUrlBody = {
  eflUrl?: string;
  forceReparse?: boolean;
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

    const fetched = await fetchEflPdfFromUrl(eflUrl);
    if (!fetched.ok) {
      return NextResponse.json(
        { ok: false, error: `Failed to fetch EFL PDF: ${fetched.error}` },
        { status: 502 },
      );
    }

    const pdfBuffer = Buffer.from(fetched.pdfBytes);

    const { template, warnings: topWarnings } = await getOrCreateEflTemplate({
      source: "manual_upload",
      pdfBytes: pdfBuffer,
      filename: null,
      forceReparse,
    });

    const rawText = template.rawText ?? "";
    const rawTextTruncated = rawText.length > MAX_PREVIEW_CHARS;
    const rawTextPreview = rawTextTruncated ? rawText.slice(0, MAX_PREVIEW_CHARS) : rawText;

    const aiEnabled = process.env.OPENAI_IntelliWatt_Fact_Card_Parser === "1";
    const hasKey = !!process.env.OPENAI_API_KEY && process.env.OPENAI_API_KEY.trim().length > 0;
    const aiUsed =
      aiEnabled &&
      hasKey &&
      !Array.isArray(template.parseWarnings)
        ? false
        : !((template.parseWarnings ?? []).some((w: string) => w.includes("AI_DISABLED_OR_MISSING_KEY")));

    const ai: { enabled: boolean; hasKey: boolean; used: boolean; reason?: string } = {
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

    // Run deterministic solver pass for avg-price validation (best-effort)
    let derivedForValidation: any = null;
    try {
      const baseValidation = (template.validation as any)?.eflAvgPriceValidation ?? null;
      derivedForValidation = await solveEflValidationGaps({
        rawText,
        planRules: template.planRules ?? null,
        rateStructure: template.rateStructure ?? null,
        validation: baseValidation,
      });
    } catch {
      derivedForValidation = null;
    }

    // Best-effort persistence: if the EFL PASSes after solver (or already PASSed) and PlanRules are
    // structurally valid, upsert a RatePlan template so it appears in Templates.
    let templatePersisted: boolean = false;
    try {
      const validationAfter =
        (derivedForValidation as any)?.validationAfter ??
        (template.validation as any)?.eflAvgPriceValidation ??
        null;
      const finalStatus = validationAfter?.status ?? null;
      const planRules = template.planRules ?? null;

      if (finalStatus === "PASS" && planRules) {
        const prValidation = validatePlanRules(planRules as any);
        if (prValidation?.requiresManualReview !== true) {
          const canonicalRateStructure = planRulesToRateStructure(planRules as any);
          const tdsp = inferTdspTerritoryFromEflText(rawText);

          const avgRows = Array.isArray(validationAfter?.avgTableRows) ? validationAfter.avgTableRows : [];
          const pick = (kwh: number): number | null => {
            const row = avgRows.find((r: any) => Number(r?.kwh) === kwh);
            const v = Number(row?.avgPriceCentsPerKwh);
            return Number.isFinite(v) ? v : null;
          };

          await upsertRatePlanFromEfl({
            mode: "live",
            eflUrl,
            eflSourceUrl: eflUrl,
            repPuctCertificate: template.repPuctCertificate ?? null,
            eflVersionCode: template.eflVersionCode ?? null,
            eflPdfSha256: template.eflPdfSha256,
            utilityId: tdsp ?? "UNKNOWN",
            state: "TX",
            termMonths: typeof (planRules as any)?.termMonths === "number" ? (planRules as any).termMonths : null,
            rate500: pick(500),
            rate1000: pick(1000),
            rate2000: pick(2000),
            providerName: null,
            planName: null,
            planRules: planRules as any,
            rateStructure: canonicalRateStructure as any,
            validation: prValidation as any,
          });

          templatePersisted = true;
        }
      }
    } catch {
      templatePersisted = false;
    }

    return NextResponse.json({
      ok: true,
      eflUrl,
      eflPdfSha256: template.eflPdfSha256,
      repPuctCertificate: template.repPuctCertificate,
      eflVersionCode: template.eflVersionCode,
      warnings: topWarnings,
      prompt: "EFL PDF parsed by OpenAI using the standard planRules/rateStructure contract.",
      rawTextPreview,
      rawTextLength: rawText.length,
      rawTextTruncated,
      planRules: template.planRules,
      rateStructure: template.rateStructure,
      parseConfidence: template.parseConfidence,
      parseWarnings: template.parseWarnings,
      validation: template.validation ?? null,
      derivedForValidation,
      templatePersisted,
      extractorMethod: template.extractorMethod ?? "pdftotext",
      ai,
    });
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error("[EFL_MANUAL_URL] Failed to process EFL URL:", error);
    const message =
      error instanceof Error ? error.message : "We couldn't process that EFL URL. Please try again.";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}


