import { prisma } from "@/lib/db";
import { fetchSmtCanonicalMonthlyTotals, fetchSmtIntradayShape96, hasSmtIntervals } from "@/modules/realUsageAdapter/smt";
import {
  fetchGreenButtonCanonicalMonthlyTotals,
  fetchGreenButtonIntradayShape96,
  getLatestGreenButtonIntervalTimestamp,
  hasGreenButtonIntervals,
} from "@/modules/realUsageAdapter/greenButton";
import { dateTimePartsInTimezone } from "@/lib/time/chicago";

export type ActualUsageSource = "SMT" | "GREEN_BUTTON";

export type ActualUsageSourceAnchor = {
  source: ActualUsageSource | null;
  anchorEndDate: string | null;
  smtAnchorEndDate: string | null;
  greenButtonAnchorEndDate: string | null;
};

async function getLatestSmtIntervalTimestamp(esiid: string | null): Promise<Date | null> {
  if (!esiid) return null;
  const row = await prisma.smtInterval
    .findFirst({ where: { esiid }, orderBy: { ts: "desc" }, select: { ts: true } })
    .catch(() => null);
  return row?.ts ?? null;
}

function toAnchorDateKey(ts: Date | null, timezone: string): string | null {
  if (!ts) return null;
  return dateTimePartsInTimezone(ts, timezone)?.dateKey ?? ts.toISOString().slice(0, 10);
}

export async function resolveActualUsageSourceAnchor(args: {
  houseId: string;
  esiid: string | null;
  timezone?: string | null;
}): Promise<ActualUsageSourceAnchor> {
  const timezone = String(args.timezone ?? "America/Chicago").trim() || "America/Chicago";
  const [smtLatest, gbLatest] = await Promise.all([
    getLatestSmtIntervalTimestamp(args.esiid),
    getLatestGreenButtonIntervalTimestamp({ houseId: args.houseId }),
  ]);
  const smtMs = smtLatest ? smtLatest.getTime() : 0;
  const gbMs = gbLatest ? gbLatest.getTime() : 0;
  let source: ActualUsageSource | null = null;
  if (smtMs === 0 && gbMs === 0) source = null;
  else if (smtMs === gbMs) source = smtMs ? "SMT" : "GREEN_BUTTON";
  else source = smtMs > gbMs ? "SMT" : "GREEN_BUTTON";

  const smtAnchorEndDate = toAnchorDateKey(smtLatest, timezone);
  const greenButtonAnchorEndDate = toAnchorDateKey(gbLatest, timezone);
  const anchorEndDate = source === "SMT" ? smtAnchorEndDate : source === "GREEN_BUTTON" ? greenButtonAnchorEndDate : null;
  return { source, anchorEndDate, smtAnchorEndDate, greenButtonAnchorEndDate };
}

export async function chooseActualSource(args: { houseId: string; esiid: string | null }): Promise<ActualUsageSource | null> {
  const resolved = await resolveActualUsageSourceAnchor({
    houseId: args.houseId,
    esiid: args.esiid,
    timezone: "America/Chicago",
  });
  return resolved.source;
}

export async function hasActualIntervals(args: { houseId: string; esiid: string | null; canonicalMonths: string[] }): Promise<boolean> {
  const source = await chooseActualSource({ houseId: args.houseId, esiid: args.esiid });
  if (!source) return false;
  if (source === "SMT") {
    if (!args.esiid) return false;
    return await hasSmtIntervals({ esiid: args.esiid, canonicalMonths: args.canonicalMonths });
  }
  return await hasGreenButtonIntervals({ houseId: args.houseId, canonicalMonths: args.canonicalMonths });
}

export async function fetchActualCanonicalMonthlyTotals(args: {
  houseId: string;
  esiid: string | null;
  canonicalMonths: string[];
  /** Exclude these date keys (YYYY-MM-DD) from aggregation (e.g. Travel/Vacant). */
  excludeDateKeys?: string[];
  /** Travel/Vacant ranges: dates in these ranges are excluded from aggregation. */
  travelRanges?: Array<{ startDate: string; endDate: string }>;
}): Promise<{ source: ActualUsageSource | null; intervalsCount: number; monthlyKwhByMonth: Record<string, number> }> {
  const source = await chooseActualSource({ houseId: args.houseId, esiid: args.esiid });
  if (!source) return { source: null, intervalsCount: 0, monthlyKwhByMonth: {} };
  if (source === "SMT") {
    if (!args.esiid) return { source: "SMT", intervalsCount: 0, monthlyKwhByMonth: {} };
    const out = await fetchSmtCanonicalMonthlyTotals({
      esiid: args.esiid,
      canonicalMonths: args.canonicalMonths,
      excludeDateKeys: args.excludeDateKeys,
      travelRanges: args.travelRanges,
    });
    return { source: "SMT", intervalsCount: out.intervalsCount, monthlyKwhByMonth: out.monthlyKwhByMonth };
  }
  const out = await fetchGreenButtonCanonicalMonthlyTotals({
    houseId: args.houseId,
    canonicalMonths: args.canonicalMonths,
    excludeDateKeys: args.excludeDateKeys,
    travelRanges: args.travelRanges,
  });
  return { source: "GREEN_BUTTON", intervalsCount: out.intervalsCount, monthlyKwhByMonth: out.monthlyKwhByMonth };
}

export async function fetchActualIntradayShape96(args: {
  houseId: string;
  esiid: string | null;
  canonicalMonths: string[];
  /** Exclude these date keys (YYYY-MM-DD) from shape derivation (e.g. Travel/Vacant). */
  excludeDateKeys?: string[];
  /** Travel/Vacant ranges: dates in these ranges are excluded from shape derivation. */
  travelRanges?: Array<{ startDate: string; endDate: string }>;
}): Promise<{ source: ActualUsageSource | null; shape96: number[] | null }> {
  const source = await chooseActualSource({ houseId: args.houseId, esiid: args.esiid });
  if (!source) return { source: null, shape96: null };
  if (source === "SMT") {
    if (!args.esiid) return { source: "SMT", shape96: null };
    const shape96 = await fetchSmtIntradayShape96({
      esiid: args.esiid,
      canonicalMonths: args.canonicalMonths,
      excludeDateKeys: args.excludeDateKeys,
      travelRanges: args.travelRanges,
    });
    return { source: "SMT", shape96 };
  }
  const shape96 = await fetchGreenButtonIntradayShape96({
    houseId: args.houseId,
    canonicalMonths: args.canonicalMonths,
    excludeDateKeys: args.excludeDateKeys,
    travelRanges: args.travelRanges,
  });
  return { source: "GREEN_BUTTON", shape96 };
}

