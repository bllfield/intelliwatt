/**
 * Audit GreenButtonDatanew.xml → 15-minute load curve vs display code paths.
 * Usage: npx tsx scripts/tmp-audit-green-button-xml-curve.ts
 */
import fs from "node:fs";
import path from "node:path";

import { createHomeIntervalCalendar, localDateKey } from "@/lib/time/homeIntervalCalendar";
import { coverageWindowEndingOnDateKey } from "@/lib/usage/canonicalMetadataWindow";
import {
  countDistinctLocalSlotsByDateKey,
  resolveLatestCompleteGreenButtonDateKeyFromSlotCounts,
} from "@/lib/usage/greenButtonLocalSlot";
import { buildLoadCurveInsightsFromIntervalRows } from "@/lib/usage/fifteenMinuteLoadCurve";
import { normalizeGreenButtonReadingsTo15Min } from "@/lib/usage/greenButtonNormalize";
import { extractEspiReadingsFromXmlForTest } from "@/tests/time/helpers/espiXmlTestExtract";

const FIXTURE = path.join(process.cwd(), "docs", "GreenButtonDatanew.xml");
const TIMEZONE = "America/Chicago";

function round2(n: number): number {
  return Math.round((Number(n) || 0) * 100) / 100;
}

function curveFromNormalizedChicago(normalized: Array<{ timestamp: Date; consumptionKwh: number }>) {
  const buckets = new Map<string, { sumKw: number; count: number }>();
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: TIMEZONE,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    hourCycle: "h23",
  });
  for (const row of normalized) {
    const parts = fmt.formatToParts(row.timestamp);
    const hour = parts.find((p) => p.type === "hour")?.value ?? "00";
    const minute = parts.find((p) => p.type === "minute")?.value ?? "00";
    const hhmm = `${hour.padStart(2, "0")}:${minute.padStart(2, "0")}`;
    const kwh = row.consumptionKwh;
    const current = buckets.get(hhmm) ?? { sumKw: 0, count: 0 };
    current.sumKw += kwh * 4;
    current.count += 1;
    buckets.set(hhmm, current);
  }
  return Array.from(buckets.entries())
    .map(([hhmm, b]) => ({ hhmm, avgKw: b.count > 0 ? round2(b.sumKw / b.count) : 0 }))
    .sort((a, b) => (a.hhmm < b.hhmm ? -1 : 1));
}

function curveUtcDayGridFake(
  normalized: Array<{ timestamp: Date; consumptionKwh: number }>
): Array<{ hhmm: string; avgKw: number }> {
  const buckets = new Map<string, { sumKw: number; count: number }>();
  for (const row of normalized) {
    const ts = row.timestamp;
    const hhmm = `${String(ts.getUTCHours()).padStart(2, "0")}:${String(ts.getUTCMinutes()).padStart(2, "0")}`;
    const current = buckets.get(hhmm) ?? { sumKw: 0, count: 0 };
    current.sumKw += row.consumptionKwh * 4;
    current.count += 1;
    buckets.set(hhmm, current);
  }
  return Array.from(buckets.entries())
    .map(([hhmm, b]) => ({ hhmm, avgKw: b.count > 0 ? round2(b.sumKw / b.count) : 0 }))
    .sort((a, b) => (a.hhmm < b.hhmm ? -1 : 1));
}

function avgKw(curve: Array<{ hhmm: string; avgKw: number }>): number {
  if (!curve.length) return 0;
  return round2(curve.reduce((s, r) => s + r.avgKw, 0) / curve.length);
}

function slot(curve: Array<{ hhmm: string; avgKw: number }>, hhmm: string): number | null {
  return curve.find((r) => r.hhmm === hhmm)?.avgKw ?? null;
}

async function main() {
  if (!fs.existsSync(FIXTURE)) {
    console.error("Missing fixture:", FIXTURE);
    process.exit(1);
  }
  const xml = fs.readFileSync(FIXTURE, "utf8");
  const extracted = extractEspiReadingsFromXmlForTest(xml);
  console.log("XML readings:", extracted.readings.length, "tzOffset:", extracted.tzOffsetSeconds);

  const normalized = normalizeGreenButtonReadingsTo15Min(
    extracted.readings.map((row) => ({
      timestamp: row.startSeconds,
      durationSeconds: row.durationSeconds,
      value: Number(row.value),
      unit: "Wh",
    })),
    { maxKwhPerInterval: 10 }
  );
  console.log("Normalized 15m intervals:", normalized.length);

  const anchor = resolveLatestCompleteGreenButtonDateKeyFromSlotCounts(
    countDistinctLocalSlotsByDateKey(normalized.map((row) => ({ timestamp: new Date(row.timestamp) })))
  );
  const window = anchor ? coverageWindowEndingOnDateKey(anchor, 365) : null;
  if (!window) {
    console.error("No 365-day window");
    process.exit(1);
  }
  console.log("365 window:", window.startDate, "->", window.endDate);

  const home = createHomeIntervalCalendar(TIMEZONE);
  const inWindow = normalized.filter((row) => {
    const dk = localDateKey(new Date(row.timestamp).toISOString(), home);
    return dk && dk >= window.startDate && dk <= window.endDate;
  });
  console.log("Intervals in window:", inWindow.length);

  const usageSqlStyle = curveFromNormalizedChicago(inWindow);
  const luxonPath = buildLoadCurveInsightsFromIntervalRows(
    inWindow.map((row) => ({
      timestamp: new Date(row.timestamp).toISOString(),
      kwh: row.consumptionKwh,
    })),
    TIMEZONE
  ).fifteenMinuteAverages;
  const utcGridWrong = curveUtcDayGridFake(inWindow);

  const compareSlots = ["00:00", "00:15", "05:00", "05:15", "19:00", "19:15"];
  console.log("\n=== Slot comparison (authoritative XML → normalized → window) ===");
  console.log("User-reported Usage ~2.210 @00:00, spike ~3.180 @05:00, avg ~1.630");
  console.log("User-reported Past  ~1.130 @00:00, spike ~3.180 @19:00, avg ~1.657");
  console.log("");
  console.log(
    "Slot".padEnd(8),
    "Usage/SQL".padEnd(10),
    "Luxon(lib)".padEnd(10),
    "utcGrid".padEnd(10),
  );
  for (const hhmm of compareSlots) {
    console.log(
      hhmm.padEnd(8),
      String(slot(usageSqlStyle, hhmm) ?? "—").padEnd(10),
      String(slot(luxonPath, hhmm) ?? "—").padEnd(10),
      String(slot(utcGridWrong, hhmm) ?? "—").padEnd(10)
    );
  }
  console.log("\nCurve avg kW:");
  console.log("  Usage/SQL style:", avgKw(usageSqlStyle));
  console.log("  Luxon (fifteenMinuteLoadCurve):", avgKw(luxonPath));
  console.log("  utcDayGrid (legacy admin wrong):", avgKw(utcGridWrong));

  const luxonVsSql = compareSlots.filter((h) => slot(usageSqlStyle, h) !== slot(luxonPath, h));
  console.log("\nLuxon vs SQL mismatches:", luxonVsSql.length ? luxonVsSql : "none");

  const userReported: Record<string, number> = {
    "00:00": 2.21,
    "05:00": 3.18,
    "11:00": 1.01,
    "19:00": 1.56,
  };
  console.log("\n=== User-reported Usage UI vs XML-derived (Chicago) ===");
  for (const hhmm of compareSlots) {
    console.log(
      hhmm.padEnd(8),
      `user=${String(userReported[hhmm] ?? "—").padEnd(6)}`,
      `xmlChicago=${String(slot(usageSqlStyle, hhmm) ?? "—")}`,
    );
  }

  function rotateHhmm(hhmm: string, hours: number): string {
    const [h, m] = hhmm.split(":").map(Number);
    const total = (((h * 60 + m + hours * 60) % (24 * 60)) + 24 * 60) % (24 * 60);
    const nh = Math.floor(total / 60);
    const nm = total % 60;
    return `${String(nh).padStart(2, "0")}:${String(nm).padStart(2, "0")}`;
  }

  let bestShift = 0;
  let bestScore = Infinity;
  for (let shift = -23; shift <= 23; shift++) {
    let err = 0;
    for (const hhmm of Object.keys(userReported)) {
      const src = rotateHhmm(hhmm, shift);
      const a = userReported[hhmm];
      const b = slot(usageSqlStyle, src);
      if (b == null) continue;
      err += Math.abs(a - b);
    }
    if (err < bestScore) {
      bestScore = err;
      bestShift = shift;
    }
  }
  console.log(
    `\nBest hour-label rotation (user slot ≈ Chicago+${bestShift}h): shift=${bestShift}h total|Δ|=${round2(bestScore)}`,
  );
  for (const hhmm of Object.keys(userReported)) {
    const src = rotateHhmm(hhmm, bestShift);
    console.log(`  user ${hhmm} ≈ xml Chicago ${src} (${slot(usageSqlStyle, src)})`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
