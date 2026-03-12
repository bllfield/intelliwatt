import "server-only";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { usagePrisma } from "@/lib/db/usageClient";

export type UsageShapeActualIntervalsResult = {
  source: "SMT" | "GREEN_BUTTON" | "NONE";
  intervals: Array<{ timestamp: string; kwh: number }>;
};

const USAGE_DB_ENABLED = Boolean((process.env.USAGE_DATABASE_URL ?? "").trim());

export async function getActualIntervalsForUsageShapeProfile(args: {
  houseId: string;
  esiid: string | null;
  startDate: string;
  endDate: string;
}): Promise<UsageShapeActualIntervalsResult> {
  const start = new Date(`${args.startDate}T00:00:00.000Z`);
  const end = new Date(`${args.endDate}T23:59:59.999Z`);
  if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) || start.getTime() > end.getTime()) {
    return { source: "NONE", intervals: [] };
  }

  const esiid = String(args.esiid ?? "").trim();
  if (esiid) {
    try {
      const rows = await prisma.$queryRaw<Array<{ ts: Date; kwh: number }>>(Prisma.sql`
        WITH iv AS (
          SELECT "ts", MAX(CASE WHEN "kwh" >= 0 THEN "kwh" ELSE 0 END)::float AS kwh
          FROM "SmtInterval"
          WHERE "esiid" = ${esiid} AND "ts" >= ${start} AND "ts" <= ${end}
          GROUP BY "ts"
        )
        SELECT "ts", kwh FROM iv ORDER BY "ts" ASC
      `);
      const intervals = rows.map((r) => ({ timestamp: new Date(r.ts).toISOString(), kwh: Number(r.kwh) || 0 }));
      if (intervals.length > 0) return { source: "SMT", intervals };
    } catch {
      // Fall through to Green Button fallback.
    }
  }

  if (!USAGE_DB_ENABLED) return { source: "NONE", intervals: [] };
  try {
    const usageClient = usagePrisma as any;
    const latestRaw = await usageClient.rawGreenButton.findFirst({
      where: { homeId: args.houseId },
      orderBy: { createdAt: "desc" },
      select: { id: true },
    });
    if (!latestRaw?.id) return { source: "NONE", intervals: [] };
    const rows = (await usageClient.$queryRaw(Prisma.sql`
      SELECT "timestamp" AS ts, "consumptionKwh"::float AS kwh
      FROM "GreenButtonInterval"
      WHERE "homeId" = ${args.houseId} AND "rawId" = ${latestRaw.id}
        AND "timestamp" >= ${start} AND "timestamp" <= ${end}
      ORDER BY "timestamp" ASC
    `)) as Array<{ ts: Date; kwh: number }>;
    const intervals = rows.map((r) => ({
      timestamp: (r.ts instanceof Date ? r.ts : new Date(r.ts)).toISOString(),
      kwh: Number(r.kwh) || 0,
    }));
    return intervals.length > 0 ? { source: "GREEN_BUTTON", intervals } : { source: "NONE", intervals: [] };
  } catch {
    return { source: "NONE", intervals: [] };
  }
}
