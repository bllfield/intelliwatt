/**
 * Compare sage actual truth, Usage contract, One Path baseline read view, and Past Sim read view.
 * Usage: npx tsx scripts/tmp-audit-three-surface-parity.ts
 */
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { prisma } from "@/lib/db";
import { usagePrisma } from "@/lib/db/usageClient";
import { getActualUsageDatasetForHouse } from "@/lib/usage/actualDatasetForHouse";
import { resolveCanonicalUsage365CoverageWindow } from "@/lib/usage/canonicalMetadataWindow";
import { sageActualDailyRowsFromDataset } from "@/lib/usage/sageActualDailyTruth";
import { buildUserUsageHouseContract } from "@/lib/usage/userUsageHouseContract";
import { buildUserUsageDashboardViewModel } from "@/lib/usage/userUsageDashboardViewModel";
import { buildOnePathRunReadOnlyView } from "@/modules/onePathSim/runReadOnlyView";

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

const SOURCE_HOUSE_ID = "8a6fe8b9-601e-4f9d-aa3e-7ef0b4bddde8";
const TEST_HOME_ID = "29a3d820-2593-4673-9dd6-cd161bbd7f6f";
const USER_EMAIL = "brian@intellipath-solutions.com";
const PAST_SCENARIO_ID = "INTERVAL_PAST";

function dailyMap(rows: Array<{ date: string; kwh: number; source?: string; sourceDetail?: string }>) {
  return new Map(
    rows.map((r) => [
      String(r.date).slice(0, 10),
      {
        kwh: Math.round((Number(r.kwh) || 0) * 100) / 100,
        source: r.source,
        sourceDetail: r.sourceDetail,
      },
    ])
  );
}

function inWindow(date: string, start: string, end: string) {
  return date >= start && date <= end;
}

async function main() {
  const user = await prisma.user.findFirst({
    where: { email: USER_EMAIL },
    select: { id: true },
  });
  if (!user) {
    console.error("User not found:", USER_EMAIL);
    process.exit(1);
  }
  const userId = user.id;

  const sourceHouse = await prisma.houseAddress.findUnique({
    where: { id: SOURCE_HOUSE_ID },
    select: { id: true, esiid: true },
  });
  if (!sourceHouse?.esiid) {
    console.error("Source house missing or no esiid");
    process.exit(1);
  }

  const canonical = resolveCanonicalUsage365CoverageWindow();
  console.log("Canonical window:", canonical.startDate, "->", canonical.endDate);

  const sageResult = await getActualUsageDatasetForHouse(TEST_HOME_ID, sourceHouse.esiid, {
    skipFullYearIntervalFetch: false,
  });
  const sageDaily = sageActualDailyRowsFromDataset(sageResult.dataset);
  const sageByDate = dailyMap(sageDaily);

  const usageContract = await buildUserUsageHouseContract({
    userId,
    house: { id: SOURCE_HOUSE_ID, esiid: sourceHouse.esiid },
    lightweightActualUsage: true,
    resolvedUsage: { dataset: sageResult.dataset, alternatives: { smt: null, greenButton: null } },
  });
  const usageDataset = usageContract.dataset ?? sageResult.dataset;
  const usageVm = buildUserUsageDashboardViewModel(usageDataset);
  const usageDaily = (usageVm?.derived?.daily ?? []).map((r) => ({
    date: r.date,
    kwh: r.kwh,
    source: r.source,
    sourceDetail: r.sourceDetail,
  }));
  const usageByDate = dailyMap(usageDaily);

  const baselineView = buildOnePathRunReadOnlyView({
    dataset: usageDataset,
    baselinePassthrough: true,
  });
  const baselineByDate = dailyMap(baselineView?.dailyRows ?? []);

  // Past sim artifact from DB cache (avoids server-only sim service import chain).
  const pastCache = await usagePrisma.pastSimulatedDatasetCache.findFirst({
    where: {
      houseId: { in: [TEST_HOME_ID, SOURCE_HOUSE_ID] },
    },
    orderBy: { updatedAt: "desc" },
    select: { datasetJson: true, scenarioId: true, updatedAt: true, houseId: true },
  });
  const pastDataset =
    pastCache?.datasetJson && typeof pastCache.datasetJson === "object"
      ? (pastCache.datasetJson as Record<string, unknown>)
      : null;
  const pastView = pastDataset
    ? buildOnePathRunReadOnlyView({
        dataset: pastDataset,
        sageActualDaily: sageDaily,
      })
    : null;

  const pastByDate = dailyMap(pastView?.dailyRows ?? []);
  const pastArtifactDaily = dailyMap(
    (Array.isArray(pastDataset?.daily) ? pastDataset.daily : []) as Array<{
      date: string;
      kwh: number;
      source?: string;
      sourceDetail?: string;
    }>
  );

  console.log("\nRow counts:");
  console.log("  sage:", sageDaily.length);
  console.log("  usage VM:", usageDaily.length);
  console.log("  baseline read view:", baselineView?.dailyRows?.length ?? 0);
  console.log("  past read view:", pastView?.dailyRows?.length ?? 0);
  console.log("  past artifact daily:", pastArtifactDaily.size);
  console.log("\nCoverage labels:");
  console.log("  usage:", usageVm?.coverage?.start, "->", usageVm?.coverage?.end);
  console.log("  baseline view:", baselineView?.summary.coverageStart, "->", baselineView?.summary.coverageEnd);
  console.log("  past view:", pastView?.summary.coverageStart, "->", pastView?.summary.coverageEnd);

  const dates = [...sageByDate.keys()].filter((d) => inWindow(d, canonical.startDate, canonical.endDate)).sort();

  let sageVsUsage = 0;
  let sageVsBaseline = 0;
  let usageVsBaseline = 0;
  let pastActualVsSage = 0;
  let pastActualVsBaseline = 0;
  let preWindowPast = 0;
  let postWindowPast = 0;
  const samples: string[] = [];

  for (const d of dates) {
    const s = sageByDate.get(d)?.kwh;
    const u = usageByDate.get(d)?.kwh;
    const b = baselineByDate.get(d)?.kwh;
    const p = pastByDate.get(d);

    if (s !== undefined && u !== undefined && Math.abs(s - u) > 0.01) sageVsUsage++;
    if (s !== undefined && b !== undefined && Math.abs(s - b) > 0.01) sageVsBaseline++;
    if (u !== undefined && b !== undefined && Math.abs(u - b) > 0.01) usageVsBaseline++;

    if (p) {
      if (d < canonical.startDate) preWindowPast++;
      if (d > canonical.endDate) postWindowPast++;
      const src = String(p.source ?? "").toUpperCase();
      if (src === "ACTUAL" || src.startsWith("ACTUAL")) {
        if (s !== undefined && Math.abs((p.kwh ?? 0) - s) > 0.01) pastActualVsSage++;
        if (b !== undefined && Math.abs((p.kwh ?? 0) - b) > 0.01) pastActualVsBaseline++;
        if (pastActualVsSage <= 5 && Math.abs((p.kwh ?? 0) - (s ?? 0)) > 0.01) {
          samples.push(`${d}: past=${p.kwh} sage=${s} base=${b} detail=${p.sourceDetail}`);
        }
      }
    }
  }

  const pastOutside = [...pastByDate.keys()].filter(
    (d) => !inWindow(d, canonical.startDate, canonical.endDate)
  );

  console.log("\nParity (canonical window, ±0.01 kWh):");
  console.log("  sage vs usage daily:", sageVsUsage, "mismatches");
  console.log("  sage vs baseline view:", sageVsBaseline, "mismatches");
  console.log("  usage vs baseline view:", usageVsBaseline, "mismatches");
  console.log("  past ACTUAL vs sage:", pastActualVsSage, "mismatches");
  console.log("  past ACTUAL vs baseline:", pastActualVsBaseline, "mismatches");
  console.log("  past rows outside window:", pastOutside.length, pastOutside.slice(0, 5));
  console.log("  pre-window past rows (in sage loop):", preWindowPast);

  const tail = ["2026-05-16", "2026-05-17", "2026-05-18", "2025-05-19", "2025-05-18"];
  console.log("\nTail / edge days:");
  for (const d of tail) {
    const s = sageByDate.get(d);
    const u = usageByDate.get(d);
    const b = baselineByDate.get(d);
    const p = pastByDate.get(d);
    console.log(
      `  ${d}: sage=${s?.kwh ?? "—"} usage=${u?.kwh ?? "—"} base=${b?.kwh ?? "—"} past=${p?.kwh ?? "—"} pastSrc=${p?.sourceDetail ?? p?.source ?? "—"}`
    );
  }

  if (samples.length) {
    console.log("\nSample past ACTUAL != sage:");
    for (const line of samples) console.log(" ", line);
  }

  if (!pastCache) {
    console.log("\nNo Past sim cache row found for test home (re-run Past Sim in admin to populate).");
  } else {
    console.log("\nPast cache:", pastCache.scenarioId, "updated", pastCache.updatedAt);
  }

  const simulatedPast = [...pastByDate.entries()].filter(([, v]) => String(v.source).toUpperCase() === "SIMULATED");
  console.log("\nPast SIMULATED days in display:", simulatedPast.length);

  await prisma.$disconnect();

  const ok =
    sageVsUsage === 0 &&
    sageVsBaseline === 0 &&
    usageVsBaseline === 0 &&
    pastActualVsSage === 0 &&
    pastActualVsBaseline === 0 &&
    pastOutside.length === 0 &&
    (pastView?.dailyRows?.length ?? 0) === dates.length;

  console.log(ok ? "\nPASS: all checked surfaces align." : "\nFAIL: see mismatches above.");
  process.exit(ok ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
