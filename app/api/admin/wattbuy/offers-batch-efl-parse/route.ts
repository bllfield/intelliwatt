import { NextRequest, NextResponse } from "next/server";
import { Buffer } from "node:buffer";

import { wbGetOffers } from "@/lib/wattbuy/client";
import { normalizeOffers } from "@/lib/wattbuy/normalize";
import { deterministicEflExtract } from "@/lib/efl/eflExtractor";
import { getOrCreateEflTemplate } from "@/lib/efl/getOrCreateEflTemplate";

export const dynamic = "force-dynamic";

const ADMIN_TOKEN = process.env.ADMIN_TOKEN;

type BatchMode = "STORE_TEMPLATES_ON_PASS" | "DRY_RUN";

type BatchRequest = {
  address?: {
    line1?: string | null;
    city?: string | null;
    state?: string | null;
    zip?: string | null;
  } | null;
  offerLimit?: number | null;
  mode?: BatchMode | null;
};

type BatchResultRow = {
  offerId: string | null;
  supplier: string | null;
  planName: string | null;
  termMonths: number | null;
  tdspName: string | null;
  eflUrl: string | null;
  eflPdfSha256: string | null;
  repPuctCertificate: string | null;
  eflVersionCode: string | null;
  validationStatus: string | null;
  tdspAppliedMode: string | null;
  parseConfidence: number | null;
  templateAction: "HIT" | "CREATED" | "SKIPPED" | "NOT_ELIGIBLE";
  queueReason?: string | null;
  notes?: string | null;
  diffs?: Array<{
    kwh: number;
    expected: number | null;
    modeled: number | null;
    diff: number | null;
    ok: boolean;
  }>;
};

type BatchResponse =
  | {
      ok: true;
      mode: BatchMode;
      offerCount: number;
      processedCount: number;
      results: BatchResultRow[];
    }
  | {
      ok: false;
      error: string;
      details?: unknown;
    };

function jsonError(status: number, error: string, details?: unknown) {
  const body: BatchResponse = {
    ok: false,
    error,
    ...(details ? { details } : {}),
  };
  return NextResponse.json(body, { status });
}

export async function POST(req: NextRequest) {
  try {
    if (!ADMIN_TOKEN) {
      return jsonError(500, "ADMIN_TOKEN is not configured");
    }

    const headerToken = req.headers.get("x-admin-token");
    if (!headerToken || headerToken !== ADMIN_TOKEN) {
      return jsonError(401, "Unauthorized (invalid admin token)");
    }

    let body: BatchRequest;
    try {
      body = (await req.json()) as BatchRequest;
    } catch {
      return jsonError(400, "Invalid JSON body");
    }

    const addr = body.address ?? null;
    const line1 = (addr?.line1 ?? "").trim();
    const city = (addr?.city ?? "").trim();
    const state = (addr?.state ?? "").trim();
    const zip = (addr?.zip ?? "").trim();

    if (!line1 || !city || !state || !zip) {
      return jsonError(400, "address.line1, address.city, address.state, and address.zip are required.");
    }

    const offerLimitRaw = body.offerLimit ?? null;
    const offerLimit = Math.max(
      1,
      Math.min(50, offerLimitRaw && Number.isFinite(offerLimitRaw) ? Number(offerLimitRaw) : 25),
    );

    const mode: BatchMode = body.mode === "STORE_TEMPLATES_ON_PASS" ? "STORE_TEMPLATES_ON_PASS" : "DRY_RUN";

    // 1) Fetch offers from WattBuy via the existing client + normalizer.
    const offersRes = await wbGetOffers({
      address: line1,
      city,
      state,
      zip,
    });

    if (!offersRes.ok || !offersRes.data) {
      return jsonError(502, "Failed to fetch offers from WattBuy", {
        status: offersRes.status,
        text: offersRes.text,
      });
    }

    const { offers } = normalizeOffers(offersRes.data);
    const sliced = offers.slice(0, offerLimit);

    const results: BatchResultRow[] = [];
    let processedCount = 0;

    for (const offer of sliced) {
      const offerId = (offer as any)?.offer_id ?? null;
      const supplier: string | null =
        (offer as any)?.supplier_name ?? (offer as any)?.supplier ?? null;
      const planName: string | null =
        (offer as any)?.plan_name ?? (offer as any)?.offer_name ?? offerId;
      const termMonths: number | null =
        typeof (offer as any)?.term === "number" && Number.isFinite((offer as any)?.term)
          ? (offer as any).term
          : null;
      const tdspName: string | null =
        (offer as any)?.offer_data?.utility ?? (offer as any)?.tdspName ?? null;
      const eflUrl: string | null = (offer as any)?.docs?.efl ?? null;

      if (!eflUrl) {
        results.push({
          offerId,
          supplier,
          planName,
          termMonths,
          tdspName,
          eflUrl: null,
          eflPdfSha256: null,
          repPuctCertificate: null,
          eflVersionCode: null,
          validationStatus: null,
          tdspAppliedMode: null,
          parseConfidence: null,
          templateAction: "NOT_ELIGIBLE",
          notes: "No EFL URL present on offer.",
        });
        continue;
      }

      processedCount++;

      try {
        const res = await fetch(eflUrl);
        if (!res.ok) {
          results.push({
            offerId,
            supplier,
            planName,
            termMonths,
            tdspName,
            eflUrl,
            eflPdfSha256: null,
            repPuctCertificate: null,
            eflVersionCode: null,
            validationStatus: null,
            tdspAppliedMode: null,
            parseConfidence: null,
            templateAction: "SKIPPED",
            notes: `Failed to fetch EFL PDF: HTTP ${res.status} ${res.statusText}`,
          });
          continue;
        }

        const arrayBuffer = await res.arrayBuffer();
        const pdfBytes = Buffer.from(arrayBuffer);

        const extract = await deterministicEflExtract(pdfBytes);
        const rawText = extract.rawText ?? "";

        if (!rawText.trim()) {
          results.push({
            offerId,
            supplier,
            planName,
            termMonths,
            tdspName,
            eflUrl,
            eflPdfSha256: extract.eflPdfSha256 ?? null,
            repPuctCertificate: extract.repPuctCertificate ?? null,
            eflVersionCode: extract.eflVersionCode ?? null,
            validationStatus: null,
            tdspAppliedMode: null,
            parseConfidence: null,
            templateAction: "SKIPPED",
            notes: "deterministicEflExtract returned empty rawText; skipped.",
          });
          continue;
        }

        const { template, wasCreated } = await getOrCreateEflTemplate({
          source: "wattbuy",
          rawText,
          eflPdfSha256: extract.eflPdfSha256 ?? null,
          repPuctCertificate: extract.repPuctCertificate ?? null,
          eflVersionCode: extract.eflVersionCode ?? null,
          wattbuy: {
            providerName: supplier,
            planName,
            termMonths,
            tdspName,
            offerId,
          },
        });

        const baseValidation = (template.validation as any)?.eflAvgPriceValidation ?? null;
        const solved = template.derivedForValidation ?? null;
        const effectiveValidation = solved?.validationAfter ?? baseValidation ?? null;

        const status: string | null = effectiveValidation?.status ?? null;
        const tdspAppliedMode: string | null =
          effectiveValidation?.assumptionsUsed?.tdspAppliedMode ?? null;

        const diffs =
          Array.isArray(effectiveValidation?.points) && effectiveValidation.points.length
            ? effectiveValidation.points.map((p: any) => ({
                kwh: p.usageKwh,
                expected: p.expectedAvgCentsPerKwh ?? null,
                modeled: p.modeledAvgCentsPerKwh ?? null,
                diff: p.diffCentsPerKwh ?? null,
                ok: Boolean(p.ok),
              }))
            : undefined;

        let templateAction: BatchResultRow["templateAction"] = "SKIPPED";
        if (status === "PASS") {
          templateAction = wasCreated ? "CREATED" : "HIT";
        } else if (status == null) {
          templateAction = "SKIPPED";
        }

        // Mode is primarily for future extension; getOrCreateEflTemplate already
        // handles creation vs cache, so we don't gate it here. The mode is still
        // useful for the UI to decide whether to trust/store results.

        results.push({
          offerId,
          supplier,
          planName,
          termMonths,
          tdspName,
          eflUrl,
          eflPdfSha256: template.eflPdfSha256 ?? extract.eflPdfSha256 ?? null,
          repPuctCertificate: template.repPuctCertificate ?? extract.repPuctCertificate ?? null,
          eflVersionCode: template.eflVersionCode ?? extract.eflVersionCode ?? null,
          validationStatus: status,
          tdspAppliedMode,
          parseConfidence: template.parseConfidence ?? null,
          templateAction,
          queueReason: effectiveValidation?.queueReason ?? null,
          notes:
            extract.warnings && extract.warnings.length
              ? extract.warnings.join(" • ")
              : undefined,
          diffs,
        });
      } catch (err: any) {
        results.push({
          offerId,
          supplier,
          planName,
          termMonths,
          tdspName,
          eflUrl,
          eflPdfSha256: null,
          repPuctCertificate: null,
          eflVersionCode: null,
          validationStatus: null,
          tdspAppliedMode: null,
          parseConfidence: null,
          templateAction: "SKIPPED",
          notes: err?.message || String(err),
        });
      }
    }

    const bodyOut: BatchResponse = {
      ok: true,
      mode,
      offerCount: offers.length,
      processedCount,
      results,
    };

    return NextResponse.json(bodyOut);
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error("[ADMIN_WATTBUY_BATCH_EFL_PARSE] Unexpected error:", error);
    return jsonError(
      500,
      "Internal error while running WattBuy batch EFL parser",
      error instanceof Error ? error.message : String(error),
    );
  }
}


