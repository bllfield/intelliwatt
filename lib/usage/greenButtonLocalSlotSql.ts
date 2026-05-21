import type { Prisma } from "@prisma/client";

/** Distinct 15-min slot index from local midnight (DST-safe; matches homeIntervalCalendar). */
export function greenButtonChicagoLocalSlotSql(): Prisma.Sql {
  if (typeof window !== "undefined") {
    throw new Error("greenButtonChicagoLocalSlotSql cannot run in the browser");
  }
  const { Prisma: PrismaRuntime } = require("@prisma/client") as typeof import("@prisma/client");
  return PrismaRuntime.sql`
    FLOOR(
      EXTRACT(
        EPOCH FROM (
          ("timestamp" AT TIME ZONE 'America/Chicago')
          - date_trunc('day', "timestamp" AT TIME ZONE 'America/Chicago')
        )
      ) / 900
    )::int
  `;
}
