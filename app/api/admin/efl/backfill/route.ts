import { NextRequest, NextResponse } from "next/server";

import { getOrCreateEflTemplate } from "@/lib/efl/getOrCreateEflTemplate";

export const dynamic = "force-dynamic";

type BackfillBody = {
  limit?: number;
  providerName?: string | null;
  tdspName?: string | null;
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

    const offers = Array.isArray(body.offers) ? body.offers : [];

    if (!offers.length) {
      return NextResponse.json({
        ok: true,
        processed: 0,
        created: 0,
        hits: 0,
        misses: 0,
        warnings: [
          "No offers array provided; automated WattBuy fetch is not wired in this step. Pass offers[] with optional rawText to backfill.",
        ],
      });
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
          od.supplier_name ?? od.supplier ?? (offer as any)?.supplierName ?? null;
        const tdspName: string | null =
          od.utility ?? (offer as any)?.tdspName ?? null;

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
          typeof od.term === "number" && Number.isFinite(od.term) ? od.term : null;

        const res = await getOrCreateEflTemplate({
          source: "wattbuy",
          rawText,
          eflPdfSha256: (offer as any)?.eflPdfSha256 ?? null,
          repPuctCertificate: (offer as any)?.repPuctCertificate ?? null,
          eflVersionCode: (offer as any)?.eflVersionCode ?? null,
          wattbuy: {
            providerName,
            planName: (offer as any)?.offer_name ?? null,
            termMonths,
            tdspName,
            offerId: (offer as any)?.offer_id ?? null,
          },
        });

        if (res.wasCreated) {
          created++;
          misses++;
        } else {
          hits++;
        }

        if (Array.isArray(res.warnings) && res.warnings.length > 0) {
          warnings.push(
            `Offer ${offer?.offer_id ?? "unknown"}: ${res.warnings.join(" • ")}`,
          );
        }
      } catch (err: any) {
        warnings.push(
          `Offer ${offer?.offer_id ?? "unknown"}: backfill failed: ${
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


