// scripts/admin/usage-bucket-backfill.ts
//
// Compute and upsert CANONICAL monthly usage buckets for a home from existing interval data.
// - Does NOT rewrite legacy keys; it only ensures canonical keys exist for target months.
//
// Usage:
//   npm run admin:usage:buckets:backfill -- --homeId=<uuid> --months=12 --mode=all --dryRun=1
//   npm run admin:usage:buckets:backfill -- --homeId=<uuid> --months=12 --mode=all
//
// Args:
//   --homeId=<uuid>                 (required)
//   --months=12                     (optional default 12, max 24)
//   --mode=tou-daynight|free-weekends|all (optional default all)
//   --dryRun=1                      (optional; if set, compute coverage only, no writes)
//   --tz=America/Chicago            (optional default America/Chicago; currently only this is supported)
//

import { existsSync, readFileSync } from "fs";
import { resolve } from "path";

// @ts-ignore - tsx may not resolve @/ paths, using relative
import { prisma } from "../../lib/db";
// @ts-ignore - tsx may not resolve @/ paths, using relative
import { usagePrisma } from "../../lib/db/usageClient";

// @ts-ignore - tsx may not resolve @/ paths, using relative
import { ensureCoreMonthlyBuckets } from "../../lib/usage/aggregateMonthlyBuckets";

import { bucketRuleFromParsedKey, canonicalizeMonthlyBucketKey, parseMonthlyBucketKey, type UsageBucketDef } from "../../lib/plan-engine/usageBuckets";

type Mode = "tou-daynight" | "free-weekends" | "all";

type Args = {
  homeId: string | null;
  months: number;
  mode: Mode;
  dryRun: boolean;
  tz: "America/Chicago";
};

function loadEnvLocalIfPresent() {
  const envPath = resolve(process.cwd(), ".env.local");
  if (!existsSync(envPath)) return;
  try {
    const envContent = readFileSync(envPath, "utf-8");
    for (const line of envContent.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const equalIndex = trimmed.indexOf("=");
      if (equalIndex <= 0) continue;
      const key = trimmed.slice(0, equalIndex).trim();
      const rawValue = trimmed.slice(equalIndex + 1).trim();
      const value = rawValue.replace(/^["']|["']$/g, "");
      if (key) process.env[key] = value;
    }
  } catch {
    // ignore
  }
}

function parseArgs(argv: string[]): Args {
  let homeId: string | null = null;
  let months = 12;
  let mode: Mode = "all";
  let dryRun = false;
  let tz: "America/Chicago" = "America/Chicago";

  for (const a of argv) {
    if (a.startsWith("--homeId=")) homeId = a.slice("--homeId=".length).trim() || null;
    if (a.startsWith("--months=")) {
      const raw = a.slice("--months=".length).trim();
      const n = raw ? Number(raw) : NaN;
      if (Number.isFinite(n)) months = Math.max(1, Math.min(24, Math.floor(n)));
    }
    if (a.startsWith("--mode=")) {
      const m = a.slice("--mode=".length).trim();
      if (m === "tou-daynight" || m === "free-weekends" || m === "all") mode = m;
    }
    if (a === "--dryRun=1" || a === "--dryRun=true") dryRun = true;
    if (a.startsWith("--tz=")) {
      const t = a.slice("--tz=".length).trim();
      if (t === "America/Chicago") tz = "America/Chicago";
    }
  }

  return { homeId, months, mode, dryRun, tz };
}

function fmtYearMonth(y: number, m1: number): string {
  return `${String(y).padStart(4, "0")}-${String(m1).padStart(2, "0")}`;
}

function parseYearMonth(ym: string): { year: number; month: number } | null {
  const s = String(ym ?? "").trim();
  const m = s.match(/^(\d{4})-(\d{2})$/);
  if (!m?.[1] || !m?.[2]) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  if (!Number.isInteger(year) || year < 2000 || year > 2100) return null;
  if (!Number.isInteger(month) || month < 1 || month > 12) return null;
  return { year, month };
}

function addMonths(ym: { year: number; month: number }, delta: number): { year: number; month: number } {
  const idx = ym.year * 12 + (ym.month - 1) + delta;
  const year = Math.floor(idx / 12);
  const month = (idx % 12) + 1;
  return { year, month };
}

function lastInstantOfMonthUtc(year: number, month1: number): Date {
  // month1 is 1..12. Date.UTC month is 0..11; day 0 gives last day of previous month.
  return new Date(Date.UTC(year, month1, 0, 23, 59, 59, 999));
}

function firstInstantOfMonthUtc(year: number, month1: number): Date {
  return new Date(Date.UTC(year, month1 - 1, 1, 0, 0, 0, 0));
}

function chicagoYearMonthForNow(): { year: number; month: number } {
  const fmt = new Intl.DateTimeFormat("en-US", { timeZone: "America/Chicago", year: "numeric", month: "2-digit" });
  const parts = fmt.formatToParts(new Date());
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  const year = Number(get("year"));
  const month = Number(get("month"));
  if (!Number.isFinite(year) || !Number.isFinite(month)) return { year: 1970, month: 1 };
  return { year, month };
}

function buildTargetMonths(end: { year: number; month: number }, months: number): string[] {
  const out: string[] = [];
  for (let i = months - 1; i >= 0; i--) {
    const p = addMonths(end, -i);
    out.push(fmtYearMonth(p.year, p.month));
  }
  return out;
}

function keysForMode(mode: Mode): string[] {
  const tou = ["kwh.m.all.total", "kwh.m.all.0700-2000", "kwh.m.all.2000-0700"];
  const fw = ["kwh.m.all.total", "kwh.m.weekday.total", "kwh.m.weekend.total"];
  const all = Array.from(new Set([...tou, ...fw]));
  return mode === "tou-daynight" ? tou : mode === "free-weekends" ? fw : all;
}

function makeBucketDefs(keys: string[]): UsageBucketDef[] {
  const out: UsageBucketDef[] = [];
  const seen = new Set<string>();
  for (const k of keys) {
    const canonicalKey = canonicalizeMonthlyBucketKey(k);
    if (!canonicalKey) continue;
    if (seen.has(canonicalKey)) continue;
    seen.add(canonicalKey);

    const parsed = parseMonthlyBucketKey(canonicalKey);
    if (!parsed) {
      // Safety: skip unparseable keys (should not happen for our canonical set).
      continue;
    }
    const rule = bucketRuleFromParsedKey(parsed);
    out.push({
      key: canonicalKey,
      label: `Monthly kWh (${canonicalKey})`,
      rule,
    });
  }
  return out;
}

async function getCoverage(args: { homeId: string; months: string[]; keys: string[] }) {
  const rows =
    args.months.length > 0 && args.keys.length > 0
      ? await usagePrisma.homeMonthlyUsageBucket.findMany({
          where: { homeId: args.homeId, yearMonth: { in: args.months }, bucketKey: { in: args.keys as any } },
          select: { yearMonth: true, bucketKey: true },
        })
      : [];

  const presentByMonth = new Map<string, Set<string>>();
  for (const r of rows) {
    const ym = String(r.yearMonth);
    const key = String(r.bucketKey);
    if (!presentByMonth.has(ym)) presentByMonth.set(ym, new Set<string>());
    presentByMonth.get(ym)!.add(key);
  }

  const missingByMonth = args.months.map((ym) => {
    const present = presentByMonth.get(ym) ?? new Set<string>();
    const missing = args.keys.filter((k) => !present.has(k));
    return { yearMonth: ym, missing };
  });

  const fullyCovered = missingByMonth.filter((m) => m.missing.length === 0).length;
  const missingCountsByKey: Record<string, number> = {};
  for (const m of missingByMonth) {
    for (const k of m.missing) missingCountsByKey[k] = (missingCountsByKey[k] ?? 0) + 1;
  }

  return { missingByMonth, fullyCovered, missingCountsByKey };
}

function printCoverage(label: string, args: { months: string[]; keys: string[]; coverage: any }) {
  console.log(`\n=== ${label} ===`);
  console.log(`months: ${args.months.length}`);
  console.log(`keys: ${args.keys.length}`);
  console.log(`fullyCoveredMonths: ${args.coverage.fullyCovered}/${args.months.length}`);

  const missingMonths = args.coverage.missingByMonth.filter((m: any) => m.missing.length > 0);
  if (missingMonths.length > 0) {
    console.log("\nMissing by month:");
    for (const m of missingMonths) {
      console.log(`${m.yearMonth}\t missing=${m.missing.join(", ")}`);
    }
  } else {
    console.log("\nMissing by month: none");
  }

  console.log("\nMissing counts by key:");
  for (const k of args.keys) {
    console.log(`${k}\t missingMonths=${args.coverage.missingCountsByKey[k] ?? 0}`);
  }
}

async function main() {
  loadEnvLocalIfPresent();

  const { homeId, months, mode, dryRun, tz } = parseArgs(process.argv.slice(2));
  if (!homeId) {
    console.error("Missing required arg: --homeId=<uuid>");
    process.exit(1);
  }
  if (tz !== "America/Chicago") {
    console.error("Only tz=America/Chicago is supported in this script (matches the bucket evaluator).");
    process.exit(1);
  }

  const targetKeys = keysForMode(mode).map(canonicalizeMonthlyBucketKey);

  // Determine end month: prefer latest month present in usage buckets for this home; else use last full month in Chicago.
  const latestBucket = await usagePrisma.homeMonthlyUsageBucket.findFirst({
    where: { homeId },
    orderBy: { yearMonth: "desc" },
    select: { yearMonth: true },
  });
  const endYm = latestBucket?.yearMonth ? parseYearMonth(String(latestBucket.yearMonth)) : null;
  const end = endYm ?? addMonths(chicagoYearMonthForNow(), -1);
  const targetMonths = buildTargetMonths(end, months);

  // Interval source choice:
  // - Prefer SMT intervals when we can resolve an ESIID from master DB `houseAddress`.
  // - Fallback to GREENBUTTON intervals stored in usage DB by homeId.
  const house = await prisma.houseAddress.findUnique({
    where: { id: homeId } as any,
    select: { esiid: true },
  });
  const esiid = house?.esiid ? String(house.esiid).trim() : "";
  const intervalSource = esiid ? ("SMT" as const) : ("GREENBUTTON" as const);
  const source = intervalSource === "SMT" ? ("SMT" as const) : ("GREENBUTTON" as const);

  const rangeStart = firstInstantOfMonthUtc(parseYearMonth(targetMonths[0])!.year, parseYearMonth(targetMonths[0])!.month);
  const last = parseYearMonth(targetMonths[targetMonths.length - 1])!;
  const rangeEnd = lastInstantOfMonthUtc(last.year, last.month);

  console.log("\n=== Usage bucket canonical backfill ===");
  console.log(`homeId: ${homeId}`);
  console.log(`mode: ${mode}`);
  console.log(`months: ${months}`);
  console.log(`dryRun: ${dryRun ? "yes" : "no"}`);
  console.log(`intervalSource: ${intervalSource}`);
  if (intervalSource === "SMT") console.log(`esiid: ${esiid || "∅"}`);
  console.log(`rangeStart(utc): ${rangeStart.toISOString()}`);
  console.log(`rangeEnd(utc):   ${rangeEnd.toISOString()}`);
  console.log(`endYearMonth: ${fmtYearMonth(end.year, end.month)}`);

  const before = await getCoverage({ homeId, months: targetMonths, keys: targetKeys });
  printCoverage("BEFORE", { months: targetMonths, keys: targetKeys, coverage: before });

  if (dryRun) {
    console.log("\nDry run only — no writes performed.");
    return;
  }

  const bucketDefs = makeBucketDefs(targetKeys);
  console.log(`\nCompute: bucketDefs=${bucketDefs.length}`);

  const res = await ensureCoreMonthlyBuckets({
    homeId,
    esiid: intervalSource === "SMT" ? esiid : null,
    rangeStart,
    rangeEnd,
    source,
    intervalSource,
    bucketDefs,
  });

  console.log("\nCompute result:");
  console.log(`monthsProcessed: ${res.monthsProcessed}`);
  console.log(`rowsUpserted: ${res.rowsUpserted}`);
  console.log(`intervalRowsRead: ${res.intervalRowsRead}`);
  console.log(`kwhSummed: ${res.kwhSummed}`);
  console.log(`notes: ${res.notes.join(" | ")}`);

  const after = await getCoverage({ homeId, months: targetMonths, keys: targetKeys });
  printCoverage("AFTER", { months: targetMonths, keys: targetKeys, coverage: after });
}

main()
  .catch((e: any) => {
    console.error("Backfill failed:", e?.message ?? String(e));
    process.exitCode = 1;
  })
  .finally(async () => {
    try {
      await usagePrisma.$disconnect();
    } catch {
      // ignore
    }
    try {
      await prisma.$disconnect();
    } catch {
      // ignore
    }
  });

