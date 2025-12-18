import { NextRequest, NextResponse } from "next/server";

import { getOrCreateEflTemplate } from "@/lib/efl/getOrCreateEflTemplate";
import { getOffersForAddress } from "@/lib/wattbuy/client";
import { normalizeOffers } from "@/lib/wattbuy/normalize";
import { fetchEflPdfFromUrl } from "@/lib/efl/fetchEflPdf";
import { deterministicEflExtract } from "@/lib/efl/eflExtractor";

export const dynamic = "force-dynamic";

type BackfillBody = {
  limit?: number;
  providerName?: string | null;
  tdspName?: string | null;
  zip?: string | null;
  offers?: any[]; // Optional: caller-provided WattBuy offers with optional rawText
};

function jsonError(status: number, error: string, details?: unknown) {
  const body: { ok: false; error: string; details?: unknown } = {
    ok: false,
    error,
    ...(details ? { details } : {}),
  };
  return NextResponse.json(body, { status });
}

export async function POST(req: NextRequest) {
  try {
    const adminToken = process.env.ADMIN_TOKEN;
    if (!adminToken) {
      return jsonError(500, "ADMIN_TOKEN is not configured");
    }

    const headerToken = req.headers.get("x-admin-token");
    if (!headerToken || headerToken !== adminToken) {
      return jsonError(401, "Unauthorized (invalid admin token)");
    }

    let body: BackfillBody;
    try {
      body = (await req.json()) as BackfillBody;
    } catch {
      return jsonError(400, "Invalid JSON body");
    }

    const limit = Math.max(1, Math.min(200, Number(body.limit) || 20));
    const providerFilter = (body.providerName ?? "").toLowerCase().trim();
    const tdspFilter = (body.tdspName ?? "").toLowerCase().trim();

    let offers = Array.isArray(body.offers) ? body.offers : [];

    if (!offers.length) {
      const zip = String(body.zip || "75201").trim();
      if (!/^\d{5}$/.test(zip)) {
        return jsonError(400, "Invalid zip (expected 5 digits)", { zip });
      }

      // Auto-fetch WattBuy offers by ZIP (address optional in our WattBuy client).
      // Then fetch each offer's EFL PDF and extract rawText via the pdftotext helper.
      const fetchedWarnings: string[] = [];
      let fetchedOffersCount = 0;
      try {
        const upstream = await getOffersForAddress({ zip });
        const normalized = normalizeOffers(upstream ?? {});
        const list = Array.isArray(normalized.offers) ? normalized.offers : [];
        fetchedOffersCount = list.length;

        const hydrated: any[] = [];
        for (const o of list.slice(0, limit)) {
          try {
            const offerId = (o as any)?.offer_id ?? null;
            const eflUrl = (o as any)?.docs?.efl ?? null;
            const fallbackUrl = (o as any)?.enroll_link ?? null;
            const url = (eflUrl && String(eflUrl).trim()) ? String(eflUrl).trim() : (fallbackUrl ? String(fallbackUrl).trim() : "");
            if (!url) {
              fetchedWarnings.push(`Offer ${offerId ?? "unknown"}: missing EFL url; skipped.`);
              continue;
            }

            const pdf = await fetchEflPdfFromUrl(url);
            if (!pdf.ok) {
              fetchedWarnings.push(`Offer ${offerId ?? "unknown"}: fetchEflPdfFromUrl failed: ${pdf.error}`);
              continue;
            }

            const det = await deterministicEflExtract(pdf.pdfBytes);
            if (!det.rawText || !det.rawText.trim()) {
              fetchedWarnings.push(`Offer ${offerId ?? "unknown"}: extracted rawText empty; skipped.`);
              continue;
            }

            hydrated.push({
              ...(o as any),
              rawText: det.rawText,
              eflPdfSha256: det.eflPdfSha256,
              repPuctCertificate: det.repPuctCertificate,
              eflVersionCode: det.eflVersionCode,
              // Keep a hint for debugging.
              _backfill: { zip, sourceUrl: url, pdfSource: pdf.source, pdfUrl: pdf.pdfUrl },
            });
          } catch (err: any) {
            fetchedWarnings.push(
              `Offer ${(o as any)?.offer_id ?? "unknown"}: hydrate failed: ${err?.message || String(err)}`,
            );
          }
        }

        offers = hydrated;
      } catch (err: any) {
        return jsonError(502, "Failed to auto-fetch WattBuy offers for zip", {
          zip,
          message: err?.message || String(err),
        });
      }

      if (!offers.length) {
        return NextResponse.json({
          ok: true,
          fetchedZip: zip,
          fetchedOffers: fetchedOffersCount,
          processed: 0,
          created: 0,
          hits: 0,
          misses: 0,
          warnings: [
            ...(fetchedWarnings.length ? fetchedWarnings : []),
            `No offers were hydrated for backfill (zip=${zip}).`,
          ],
        });
      }
    }

    let processed = 0;
    let created = 0;
    let hits = 0;
    let misses = 0;
    const warnings: string[] = [];

    for (const offer of offers.slice(0, limit)) {
      try {
        const od = (offer as any)?.offer_data ?? {};

        const providerName: string | null =
          od.supplier_name ??
          od.supplier ??
          (offer as any)?.supplierName ??
          (offer as any)?.supplier_name ??
          (offer as any)?.supplier ??
          null;
        const tdspName: string | null =
          od.utility ?? (offer as any)?.tdspName ?? (offer as any)?.distributor_name ?? null;

        if (providerFilter && (providerName ?? "").toLowerCase().trim() !== providerFilter) {
          continue;
        }
        if (tdspFilter && (tdspName ?? "").toLowerCase().trim() !== tdspFilter) {
          continue;
        }

        const rawText: string | null =
          (offer as any)?.rawText ??
          (offer as any)?.eflRawText ??
          null;

        if (!rawText || !rawText.trim()) {
          warnings.push(
            `Offer ${offer?.offer_id ?? "unknown"}: no rawText/eflRawText provided; skipped.`,
          );
          continue;
        }

        processed++;

        const termMonths =
          typeof od.term === "number" && Number.isFinite(od.term)
            ? od.term
            : typeof (offer as any)?.term_months === "number" && Number.isFinite((offer as any).term_months)
              ? (offer as any).term_months
              : null;

        const offerId = (offer as any)?.offer_id ?? (offer as any)?.offerId ?? null;
        const planName = (offer as any)?.offer_name ?? (offer as any)?.plan_name ?? (offer as any)?.planName ?? null;

        const res = await getOrCreateEflTemplate({
          source: "wattbuy",
          rawText,
          eflPdfSha256: (offer as any)?.eflPdfSha256 ?? null,
          repPuctCertificate: (offer as any)?.repPuctCertificate ?? null,
          eflVersionCode: (offer as any)?.eflVersionCode ?? null,
          wattbuy: {
            providerName,
            planName,
            termMonths,
            tdspName,
            offerId,
          },
        });

        if (res.wasCreated) {
          created++;
          misses++;
        } else {
          hits++;
        }

        if (Array.isArray(res.warnings) && res.warnings.length > 0) {
          warnings.push(`Offer ${offerId ?? "unknown"}: ${res.warnings.join(" • ")}`);
        }
      } catch (err: any) {
        warnings.push(
          `Offer ${(offer as any)?.offer_id ?? (offer as any)?.offerId ?? "unknown"}: backfill failed: ${
            err?.message || String(err)
          }`,
        );
        // Continue with the next offer.
      }
    }

    return NextResponse.json({
      ok: true,
      processed,
      created,
      hits,
      misses,
      warnings,
    });
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error("[ADMIN_EFL_BACKFILL] Failed to backfill EFL templates", error);
    return jsonError(
      500,
      "Internal error while backfilling EFL templates",
      error instanceof Error ? error.message : String(error),
    );
  }
}


