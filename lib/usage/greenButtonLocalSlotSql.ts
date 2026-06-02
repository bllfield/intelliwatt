import { Prisma } from "@prisma/client";

let cachedChicagoLocalSlotSql: Prisma.Sql | null = null;

/** Distinct 15-min slot index from local midnight (DST-safe; matches homeIntervalCalendar). */
export function greenButtonChicagoLocalSlotSql(): Prisma.Sql {
  if (typeof window !== "undefined") {
    throw new Error("greenButtonChicagoLocalSlotSql cannot run in the browser");
  }
  if (!cachedChicagoLocalSlotSql) {
    cachedChicagoLocalSlotSql = Prisma.sql`
      FLOOR(
        EXTRACT(
          EPOCH FROM (
            (("timestamp" AT TIME ZONE 'UTC') AT TIME ZONE 'America/Chicago')
            - date_trunc(
                'day',
                (("timestamp" AT TIME ZONE 'UTC') AT TIME ZONE 'America/Chicago')
              )
          )
        ) / 900
      )::int
    `;
  }
  return cachedChicagoLocalSlotSql;
}
