import { NextRequest, NextResponse } from "next/server";

import {
  findCachedEflTemplateByIdentity,
  getOrCreateEflTemplate,
} from "@/lib/efl/getOrCreateEflTemplate";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as {
      offerId?: string | null;
      providerName?: string | null;
      planName?: string | null;
      termMonths?: number | null;
      tdspName?: string | null;
      rawText?: string | null;
      eflPdfSha256?: string | null;
      repPuctCertificate?: string | null;
      eflVersionCode?: string | null;
    };

    const rawText = (body.rawText ?? "").trim();
    const baseMeta = {
      repPuctCertificate: body.repPuctCertificate ?? null,
      eflVersionCode: body.eflVersionCode ?? null,
      eflPdfSha256: (body.eflPdfSha256 ?? "").trim() || null,
      wattbuy: {
        providerName: body.providerName ?? null,
        planName: body.planName ?? null,
        termMonths:
          typeof body.termMonths === "number" && Number.isFinite(body.termMonths)
            ? body.termMonths
            : null,
        tdspName: body.tdspName ?? null,
        offerId: body.offerId ?? null,
      },
    } as const;

    // If we have raw EFL text, we are allowed to call OpenAI through the
    // shared getOrCreateEflTemplate service.
    if (rawText) {
      const { template, warnings } = await getOrCreateEflTemplate({
        source: "wattbuy",
        rawText,
        eflPdfSha256: baseMeta.eflPdfSha256,
        repPuctCertificate: baseMeta.repPuctCertificate,
        eflVersionCode: baseMeta.eflVersionCode,
        wattbuy: baseMeta.wattbuy,
      });

      return NextResponse.json({
        ok: true,
        warnings,
        planRules: template.planRules,
        rateStructure: template.rateStructure,
        parseConfidence: template.parseConfidence,
        parseWarnings: template.parseWarnings ?? [],
        repPuctCertificate: template.repPuctCertificate,
        eflVersionCode: template.eflVersionCode,
        eflPdfSha256: template.eflPdfSha256,
      });
    }

    // No raw text provided → lookup only; do not create or call OpenAI.
    const lookup = findCachedEflTemplateByIdentity(baseMeta);

    if (lookup.template) {
      const t = lookup.template;
      return NextResponse.json({
        ok: true,
        warnings: lookup.warnings,
        planRules: t.planRules,
        rateStructure: t.rateStructure,
        parseConfidence: t.parseConfidence,
        parseWarnings: t.parseWarnings ?? [],
        repPuctCertificate: t.repPuctCertificate,
        eflVersionCode: t.eflVersionCode,
        eflPdfSha256: t.eflPdfSha256,
      });
    }

    // Not found in cache and no text source; surface a soft warning so callers
    // can allow admin manual upload or later learning without blocking UI.
    return NextResponse.json({
      ok: true,
      warnings: [
        ...lookup.warnings,
        "No EFL text source provided by WattBuy; template not found. Admin upload required to learn this plan.",
      ],
      planRules: null,
      rateStructure: null,
      parseConfidence: null,
      parseWarnings: [],
      repPuctCertificate: baseMeta.repPuctCertificate,
      eflVersionCode: baseMeta.eflVersionCode,
      eflPdfSha256: baseMeta.eflPdfSha256,
    });
  } catch (error) {
    console.error("[EFL_FROM_OFFER] Failed to load EFL template from offer:", error);
    const message =
      error instanceof Error
        ? error.message
        : "We couldn't process that offer. Please try again or contact support.";

    return NextResponse.json(
      {
        ok: false,
        error: message,
      },
      { status: 500 },
    );
  }
}


