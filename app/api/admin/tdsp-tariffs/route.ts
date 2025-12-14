import { NextRequest, NextResponse } from "next/server";

import { TdspCode } from "@prisma/client";
import { db } from "@/lib/db";
import { lookupTdspCharges } from "@/lib/utility/tdspTariffs";

type TdspTariffDebugResponse = {
  ok: boolean;
  tdspCode: string | null;
  asOfDate: string | null;
  utility: any | null;
  version: any | null;
  components: any[];
  lookupSummary: {
    monthlyCents: number | null;
    perKwhCents: number | null;
    confidence: string | null;
  } | null;
  debug: string[];
};

function jsonError(
  status: number,
  error: string,
  meta?: Partial<TdspTariffDebugResponse>,
) {
  const body: TdspTariffDebugResponse = {
    ok: false,
    tdspCode: meta?.tdspCode ?? null,
    asOfDate: meta?.asOfDate ?? null,
    utility: meta?.utility ?? null,
    version: meta?.version ?? null,
    components: meta?.components ?? [],
    lookupSummary: meta?.lookupSummary ?? null,
    debug: [error, ...(meta?.debug ?? [])],
  };
  return NextResponse.json(body, { status });
}

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const adminToken = process.env.ADMIN_TOKEN;
    if (!adminToken) {
      return jsonError(500, "ADMIN_TOKEN is not configured");
    }

    const headerToken = req.headers.get("x-admin-token");
    if (!headerToken || headerToken !== adminToken) {
      return jsonError(401, "Unauthorized (invalid admin token)");
    }

    const { searchParams } = new URL(req.url);
    const code = (searchParams.get("tdspCode") || "").toUpperCase();
    const asOf = searchParams.get("asOfDate") || "";

    const debug: string[] = [];

    if (!code) {
      return jsonError(400, "Missing tdspCode query param", {
        tdspCode: null,
        asOfDate: asOf || null,
        debug,
      });
    }

    const validCodes = Object.values(TdspCode) as string[];
    if (!validCodes.includes(code)) {
      return jsonError(400, `Invalid tdspCode "${code}"`, {
        tdspCode: code,
        asOfDate: asOf || null,
        debug: [
          `Valid codes: ${validCodes.join(", ")}`,
          ...(debug.length ? debug : []),
        ],
      });
    }

    if (!asOf) {
      return jsonError(400, "Missing asOfDate query param (YYYY-MM-DD)", {
        tdspCode: code,
        asOfDate: null,
        debug,
      });
    }

    const asOfDate = new Date(asOf);
    if (Number.isNaN(asOfDate.getTime())) {
      return jsonError(400, `Invalid asOfDate "${asOf}"`, {
        tdspCode: code,
        asOfDate: asOf,
        debug,
      });
    }

    // Utility lookup
    const utility = await (db as any).tdspUtility.findUnique({
      where: { code: code as TdspCode },
    });
    if (!utility) {
      debug.push("No TdspUtility row found for this code.");
      return NextResponse.json({
        ok: true,
        tdspCode: code,
        asOfDate: asOf,
        utility: null,
        version: null,
        components: [],
        lookupSummary: null,
        debug,
      } satisfies TdspTariffDebugResponse);
    }

    // Active version lookup (same predicate as lookupTdspCharges)
    const version = await (db as any).tdspTariffVersion.findFirst({
      where: {
        tdspId: utility.id,
        effectiveStart: { lte: asOfDate },
        OR: [{ effectiveEnd: null }, { effectiveEnd: { gt: asOfDate } }],
      },
      orderBy: { effectiveStart: "desc" },
    });

    if (!version) {
      debug.push(
        `No TdspTariffVersion active at ${asOf} for utility ${utility.id}.`,
      );
      return NextResponse.json({
        ok: true,
        tdspCode: code,
        asOfDate: asOf,
        utility,
        version: null,
        components: [],
        lookupSummary: null,
        debug,
      } satisfies TdspTariffDebugResponse);
    }

    const components = await (db as any).tdspTariffComponent.findMany({
      where: { tariffVersionId: version.id },
      orderBy: [{ chargeType: "asc" }, { unit: "asc" }],
    });

    if (!components.length) {
      debug.push(
        `TdspTariffVersion ${version.id} has no TdspTariffComponent rows.`,
      );
    }

    const charges = await lookupTdspCharges({
      tdspCode: code as any,
      asOfDate,
    });

    const lookupSummary =
      charges && (charges.monthlyCents != null || charges.perKwhCents != null)
        ? {
            monthlyCents: charges.monthlyCents,
            perKwhCents: charges.perKwhCents,
            confidence: charges.confidence,
          }
        : null;

    if (!lookupSummary) {
      debug.push(
        "lookupTdspCharges() returned null or had no numeric monthly/perKwh cents.",
      );
    }

    const body: TdspTariffDebugResponse = {
      ok: true,
      tdspCode: code,
      asOfDate: asOf,
      utility,
      version,
      components,
      lookupSummary,
      debug,
    };

    return NextResponse.json(body);
  } catch (err: any) {
    const msg =
      err instanceof Error ? err.message : String(err ?? "unknown error");
    return jsonError(500, `Unexpected error: ${msg}`);
  }
}


