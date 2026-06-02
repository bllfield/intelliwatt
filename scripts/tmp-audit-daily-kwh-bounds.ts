/**
 * Compare SMT daily kWh under Chicago window bounds vs naive UTC T23:59:59 end.
 * Usage: npx tsx scripts/tmp-audit-daily-kwh-bounds.ts <esiid> [endDateKey]
 */
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { canonicalCoverageWindowUtcBounds } from "@/lib/usage/canonicalMetadataWindow";
import { resolveCanonicalUsage365CoverageWindow } from "@/lib/usage/canonicalMetadataWindow";

const envLocalPath = resolve(process.cwd(), ".env.local");
if (existsSync(envLocalPath)) {
  for (const line of readFileSync(envLocalPath, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim().replace(/^["']|["']$/g, "");
    if (key && process.env[key] === undefined) process.env[key] = value;
  }
}

const esiid = String(process.argv[2] ?? "").trim();
const endOverride = String(process.argv[3] ?? "").slice(0, 10);

async function dailyTotals(cutoff: Date, end: Date) {
  const rows = await prisma.$queryRaw<Array<{ date: string; kwh: number; slots: number }>>(Prisma.sql`
    WITH iv AS (
      SELECT "ts", MAX(CASE WHEN "kwh" >= 0 THEN "kwh" ELSE 0 END)::float AS kwh
      FROM "SmtInterval" WHERE "esiid" = ${esiid} AND "ts" >= ${cutoff} AND "ts" <= ${end}
      GROUP BY "ts"
    )
    SELECT
      to_char((("ts" AT TIME ZONE 'UTC') AT TIME ZONE 'America/Chicago')::date, 'YYYY-MM-DD') AS date,
      COALESCE(SUM("kwh"), 0)::float AS kwh,
      COUNT(*)::int AS slots
    FROM iv
    GROUP BY 1
    ORDER BY 1 ASC
  `);
  return rows.map((r) => ({
    date: String(r.date),
    kwh: Math.round(Number(r.kwh) * 100) / 100,
    slots: Number(r.slots) || 0,
  }));
}

async function main() {
  if (!esiid) {
    console.error("Usage: npx tsx scripts/tmp-audit-daily-kwh-bounds.ts <esiid> [endDateKey]");
    process.exit(1);
  }

  const window = resolveCanonicalUsage365CoverageWindow();
  const range = {
    startDate: window.startDate,
    endDate: endOverride && /^\d{4}-\d{2}-\d{2}$/.test(endOverride) ? endOverride : window.endDate,
  };
  const chicago = canonicalCoverageWindowUtcBounds(range);
  const naiveCutoff = new Date(`${range.startDate}T00:00:00.000Z`);
  const naiveEnd = new Date(`${range.endDate}T23:59:59.999Z`);

  const [correct, legacy] = await Promise.all([
    dailyTotals(chicago.rangeStart, chicago.rangeEndInclusive),
    dailyTotals(naiveCutoff, naiveEnd),
  ]);

  const legacyByDate = new Map(legacy.map((r) => [r.date, r]));
  const correctByDate = new Map(correct.map((r) => [r.date, r]));
  const allDates = Array.from(new Set([...legacyByDate.keys(), ...correctByDate.keys()])).sort();

  const mismatches: Array<{
    date: string;
    legacyKwh: number;
    correctKwh: number;
    delta: number;
    legacySlots: number;
    correctSlots: number;
  }> = [];

  for (const date of allDates) {
    const a = legacyByDate.get(date);
    const b = correctByDate.get(date);
    const legacyKwh = a?.kwh ?? 0;
    const correctKwh = b?.kwh ?? 0;
    const delta = Math.round((correctKwh - legacyKwh) * 100) / 100;
    if (Math.abs(delta) > 0.01 || (a?.slots ?? 0) !== (b?.slots ?? 0)) {
      mismatches.push({
        date,
        legacyKwh,
        correctKwh,
        delta,
        legacySlots: a?.slots ?? 0,
        correctSlots: b?.slots ?? 0,
      });
    }
  }

  const legacyTotal = Math.round(legacy.reduce((s, r) => s + r.kwh, 0) * 100) / 100;
  const correctTotal = Math.round(correct.reduce((s, r) => s + r.kwh, 0) * 100) / 100;

  console.log("\n=== SMT daily kWh bounds audit ===\n");
  console.log("esiid:", esiid);
  console.log("window:", range.startDate, "->", range.endDate);
  console.log("chicago UTC:", chicago.rangeStart.toISOString(), "->", chicago.rangeEndInclusive.toISOString());
  console.log("naive UTC:  ", naiveCutoff.toISOString(), "->", naiveEnd.toISOString());
  console.log("\nTotals: legacy", legacyTotal, "kWh | correct", correctTotal, "kWh | delta", correctTotal - legacyTotal);
  console.log("Days compared:", allDates.length);
  console.log("Days with kWh or slot mismatch:", mismatches.length);

  if (mismatches.length) {
    console.log("\nMismatched days:");
    for (const row of mismatches) {
      console.log(
        `  ${row.date}: legacy ${row.legacyKwh} kWh (${row.legacySlots} slots) -> correct ${row.correctKwh} kWh (${row.correctSlots} slots) delta ${row.delta >= 0 ? "+" : ""}${row.delta}`
      );
    }
  } else {
    console.log("\nNo per-day mismatches between legacy and Chicago bounds.");
  }

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
