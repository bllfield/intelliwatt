import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { prisma } from "@/lib/db";
import { getActualUsageDatasetForHouse } from "@/lib/usage/actualDatasetForHouse";
import { buildUserUsageHouseContract } from "@/lib/usage/userUsageHouseContract";
import { buildUserUsageDashboardViewModel } from "@/lib/usage/userUsageDashboardViewModel";
import { buildDisplayedMonthlyRows } from "@/modules/usageSimulator/monthlyCompareRows";

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

const EMAIL = "brian@intellipath-solutions.com";
const ESIID = "10400511114390001";

function low10(values: number[]): number | null {
  const finite = values.filter((v) => Number.isFinite(v));
  if (!finite.length) return null;
  const positive = finite.filter((v) => v > 1e-6).sort((a, b) => a - b);
  const count10 = Math.max(1, Math.floor((positive.length || finite.length) * 0.1));
  const slice =
    positive.length >= count10
      ? positive.slice(0, count10)
      : finite.sort((a, b) => a - b).slice(0, Math.max(1, Math.floor(finite.length * 0.1)));
  if (!slice.length) return null;
  return Math.round((slice.reduce((a, b) => a + b, 0) / slice.length) * 100) / 100;
}

async function main() {
  const user = await prisma.user.findFirst({ where: { email: EMAIL }, select: { id: true } });
  if (!user) {
    console.error("user not found");
    process.exit(1);
  }
  const house = await prisma.houseAddress.findFirst({
    where: { userId: user.id, esiid: ESIID },
    select: { id: true, esiid: true },
  });
  if (!house?.esiid) {
    console.error("house not found");
    process.exit(1);
  }

  const full = await getActualUsageDatasetForHouse(house.id, house.esiid, {
    skipFullYearIntervalFetch: false,
  });
  const light = await getActualUsageDatasetForHouse(house.id, house.esiid, {
    skipFullYearIntervalFetch: true,
    skipLightweightInsightRecompute: true,
  });

  function summarize(label: string, dataset: any) {
    const vm = buildUserUsageDashboardViewModel({ dataset });
    const monthlyRaw = (dataset?.monthly ?? []).map((r: any) => Number(r.kwh) || 0);
    const monthlyDisplayed = buildDisplayedMonthlyRows(dataset).map((r) => Number(r.kwh) || 0);
    const insights = dataset?.insights ?? {};
    return {
      label,
      insightsBaseloadMonthly: insights.baseloadMonthly ?? null,
      vmBaseloadMonthly: vm?.derived?.baseloadMonthly ?? null,
      vmBaseload15: vm?.derived?.baseload ?? null,
      baseloadMethod: insights.baseloadMethod ?? null,
      stitchedMonth: insights.stitchedMonth ?? null,
      monthlyRawCount: dataset?.monthly?.length ?? 0,
      monthlyDisplayedCount: buildDisplayedMonthlyRows(dataset).length,
      low10RawMonthly: low10(monthlyRaw),
      low10DisplayedMonthly: low10(monthlyDisplayed),
      headlineTotal: vm?.derived?.totalKwh ?? null,
      intervals: dataset?.summary?.intervalsCount ?? null,
    };
  }

  console.log("house", house.id);
  console.log(JSON.stringify(summarize("full_fetch_user_api", full.dataset), null, 2));
  console.log(JSON.stringify(summarize("lightweight_admin_lookup", light.dataset), null, 2));

  const fullContract = await buildUserUsageHouseContract({
    userId: user.id,
    house: { id: house.id, esiid: house.esiid },
    resolvedUsage: { dataset: full.dataset, alternatives: { smt: null, greenButton: null } },
  });
  const lightContract = await buildUserUsageHouseContract({
    userId: user.id,
    house: { id: house.id, esiid: house.esiid },
    resolvedUsage: { dataset: light.dataset, alternatives: { smt: null, greenButton: null } },
    lightweightActualUsage: true,
    skipLightweightInsightRecompute: true,
  });
  console.log("contract_vm_baseloadMonthly", {
    full: buildUserUsageDashboardViewModel(fullContract)?.derived?.baseloadMonthly,
    light: buildUserUsageDashboardViewModel(lightContract)?.derived?.baseloadMonthly,
  });
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
