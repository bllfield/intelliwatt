/**
 * Single read owner for persisted Green Button 15-minute intervals.
 * Rows are already normalized/repaired at ingest; this module only loads and projects.
 */

import { Prisma } from "@prisma/client";

import { usagePrisma } from "@/lib/db/usageClient";
import type { ConvertRawIntervalsResult } from "@/lib/time/homeIntervalCalendar";
import { convertGreenButtonPersistedRowsToHome } from "@/lib/time/greenButtonPersistedIntervalConvert";
import { resolveGreenButtonIntervalIngestReadiness } from "@/lib/usage/greenButtonIntervalReadiness";

const USAGE_DB_ENABLED = Boolean((process.env.USAGE_DATABASE_URL ?? "").trim());

export type PersistedGreenButtonIntervalRow = {
  timestamp: Date;
  consumptionKwh: number;
};

export async function queryPersistedGreenButtonIntervalRows(args: {
  houseId: string;
  rawId: string;
  rangeStart: Date;
  rangeEndInclusive: Date;
}): Promise<PersistedGreenButtonIntervalRow[]> {
  if (!USAGE_DB_ENABLED) return [];
  try {
    const usageClient = usagePrisma as any;
    const rows = (await usageClient.greenButtonInterval.findMany({
      where: {
        homeId: args.houseId,
        rawId: args.rawId,
        timestamp: { gte: args.rangeStart, lte: args.rangeEndInclusive },
      },
      orderBy: { timestamp: "asc" },
      select: { timestamp: true, consumptionKwh: true },
    })) as Array<{ timestamp: Date; consumptionKwh: unknown }>;
    return rows.map((row) => ({
      timestamp: row.timestamp instanceof Date ? row.timestamp : new Date(row.timestamp),
      consumptionKwh: decimalToNumber(row.consumptionKwh),
    }));
  } catch {
    return [];
  }
}

export async function queryPersistedGreenButtonIntervalRowsRaw(args: {
  houseId: string;
  rawId: string;
  rangeStart: Date;
  rangeEndInclusive: Date;
}): Promise<Array<{ ts: Date; kwh: number }>> {
  if (!USAGE_DB_ENABLED) return [];
  try {
    const usageClient = usagePrisma as any;
    return (await usageClient.$queryRaw(Prisma.sql`
      SELECT "timestamp" AS ts, "consumptionKwh"::float AS kwh
      FROM "GreenButtonInterval"
      WHERE "homeId" = ${args.houseId}
        AND "rawId" = ${args.rawId}
        AND "timestamp" >= ${args.rangeStart}
        AND "timestamp" <= ${args.rangeEndInclusive}
      ORDER BY "timestamp" ASC
    `)) as Array<{ ts: Date; kwh: number }>;
  } catch {
    return [];
  }
}

/** Project ingest-trusted DB rows onto the home interval calendar (no slot repair). */
export function projectPersistedGreenButtonRowsToHome(
  rows: PersistedGreenButtonIntervalRow[],
  homeTimezone: string
): ConvertRawIntervalsResult {
  return convertGreenButtonPersistedRowsToHome(
    rows.map((row) => ({
      timestamp: row.timestamp,
      consumptionKwh: row.consumptionKwh,
    })),
    homeTimezone
  );
}

export async function loadPersistedGreenButtonIntervalsForWindow(args: {
  houseId: string;
  rawId: string;
  rangeStart: Date;
  rangeEndInclusive: Date;
  homeTimezone: string;
  /** When false, skip ingest-version gate (tests / rehydrate tooling only). */
  requireCurrentIngest?: boolean;
}): Promise<{
  rows: PersistedGreenButtonIntervalRow[];
  converted: ConvertRawIntervalsResult;
  ingestReady: boolean;
}> {
  const requireCurrentIngest = args.requireCurrentIngest !== false;
  if (requireCurrentIngest) {
    const readiness = await resolveGreenButtonIntervalIngestReadiness(args.houseId);
    if (!readiness.ready) {
      const empty = projectPersistedGreenButtonRowsToHome([], args.homeTimezone);
      return { rows: [], converted: empty, ingestReady: false };
    }
  }
  const rows = await queryPersistedGreenButtonIntervalRows(args);
  const converted = projectPersistedGreenButtonRowsToHome(rows, args.homeTimezone);
  return { rows, converted, ingestReady: true };
}

function decimalToNumber(v: unknown): number {
  if (typeof v === "number") return v;
  if (v && typeof v === "object" && typeof (v as { toString?: () => string }).toString === "function") {
    return Number((v as { toString: () => string }).toString());
  }
  return Number(v) || 0;
}
