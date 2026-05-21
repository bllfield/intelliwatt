import { prisma } from "@/lib/db";
import { enumerateDateKeysInclusive, smtCoverageDateKey } from "@/lib/time/chicago";
import {
  enumerateExpectedLocalSlotsForDate,
  expectedSlotsForLocalDate,
  localDateKey,
  localDayBoundsUtc,
  localSlotIndex,
  missingLocalSlotsForDate,
  smtHomeIntervalCalendar,
} from "@/lib/time/homeIntervalCalendar";
import { resolveCanonicalUsage365CoverageWindow } from "@/lib/usage/canonicalMetadataWindow";
import {
  loadSmtDayLedgerSnapshot,
  SMT_DAY_LEDGER_STATUS,
  type SmtDayLedgerStatus,
} from "@/lib/usage/smtDayCoverageLedger";

/** Nominal slots on a standard 24h day; use `expectedSlotsForLocalDate` per calendar day. */
export const SMT_REQUIRED_SLOTS_PER_DAY = 96;

const SMT_HOME = smtHomeIntervalCalendar();

export function smtRequiredSlotsForDateKey(dateKey: string): number {
  return expectedSlotsForLocalDate(dateKey, SMT_HOME);
}

/**
 * SMT feeds cap at 96 rows/day. Fall-back Luxon days expect 100 wall periods but meters
 * still deliver 96 intervals; spring-forward expects 92.
 */
export function smtCompletenessIntervalThreshold(requiredSlots: number): number {
  return Math.min(requiredSlots, SMT_REQUIRED_SLOTS_PER_DAY);
}

export type SmtCanonicalWindow = {
  startDate: string;
  endDate: string;
};

/** First/last Chicago calendar day with any persisted SmtInterval row for the ESIID. */
export type SmtPersistedCoverageSpan = {
  startDate: string;
  endDate: string;
};

export type SmtWindowDayStatus = {
  dateKey: string;
  /** Distinct 15-minute intervals on this local calendar day (used for completeness). */
  intervalCount: number;
  /** Distinct local slot indices 0–95 present (falls below intervalCount on fall-back DST). */
  distinctSlotCount: number;
  /** @deprecated Use intervalCount — kept for callers that still read slotCount. */
  slotCount: number;
  requiredSlots: number;
  missingSlots: number[];
  ledgerStatus: SmtDayLedgerStatus | null;
  isComplete: boolean;
};

export type SmtWindowStatusSnapshot = {
  window: SmtCanonicalWindow;
  dateKeys: string[];
  byDate: Record<string, SmtWindowDayStatus>;
  completeDateKeys: string[];
  incompleteDateKeys: string[];
  pendingDateKeys: string[];
  incompleteMeterDateKeys: string[];
  canonicalEndDayComplete: boolean;
  ready: boolean;
};

export function resolveSmtCanonicalWindow(now: Date = new Date()): SmtCanonicalWindow {
  return resolveCanonicalUsage365CoverageWindow(now);
}

/** @deprecated Use missingLocalSlotsForDate with a dateKey for DST-aware missing slots. */
export function missingChicagoSlotsFromFilledSlots(
  filledSlots: ReadonlySet<number>,
  dateKey?: string,
): number[] {
  if (dateKey) return missingLocalSlotsForDate(filledSlots, dateKey, SMT_HOME);
  const missing: number[] = [];
  for (let slot = 0; slot < SMT_REQUIRED_SLOTS_PER_DAY; slot += 1) {
    if (!filledSlots.has(slot)) missing.push(slot);
  }
  return missing;
}

function normalizeDateKeys(values: unknown[]): string[] {
  return Array.from(
    new Set(
      values
        .map((value) => String(value ?? "").slice(0, 10))
        .filter((value) => /^\d{4}-\d{2}-\d{2}$/.test(value))
    )
  ).sort();
}

function addDateKeyDays(dateKey: string, days: number): string {
  const date = new Date(`${dateKey}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function accumulateLocalCoverageByDate(args: {
  rows: Array<{ ts: Date | string | null | undefined }>;
  requestedDateSet: Set<string>;
}): {
  intervalsByDate: Map<string, Set<string>>;
  slotsByDate: Map<string, Set<number>>;
} {
  const intervalsByDate = new Map<string, Set<string>>();
  const slotsByDate = new Map<string, Set<number>>();
  for (const row of args.rows) {
    const ts = row?.ts instanceof Date ? row.ts : row?.ts ? new Date(row.ts) : null;
    if (!ts || Number.isNaN(ts.getTime())) continue;
    const dateKey = localDateKey(ts, SMT_HOME);
    if (!dateKey || !args.requestedDateSet.has(dateKey)) continue;
    const { startUtc, endUtcExclusive } = localDayBoundsUtc(dateKey, SMT_HOME);
    if (ts < startUtc || ts >= endUtcExclusive) continue;

    const tsKey = ts.toISOString();
    const intervalBucket = intervalsByDate.get(dateKey) ?? new Set<string>();
    intervalBucket.add(tsKey);
    intervalsByDate.set(dateKey, intervalBucket);

    const slotBucket = slotsByDate.get(dateKey) ?? new Set<number>();
    slotBucket.add(localSlotIndex(ts, SMT_HOME));
    slotsByDate.set(dateKey, slotBucket);
  }
  return { intervalsByDate, slotsByDate };
}

async function loadChicagoSlotCountsByDateKeys(args: {
  esiid: string;
  dateKeys: string[];
}): Promise<{
  countsByDate: Record<string, number>;
  distinctSlotCountByDate: Record<string, number>;
  missingSlotsByDate: Record<string, number[]>;
  requiredSlotsByDate: Record<string, number>;
}> {
  const dateKeys = normalizeDateKeys(args.dateKeys);
  if (dateKeys.length === 0) {
    return {
      countsByDate: {},
      distinctSlotCountByDate: {},
      missingSlotsByDate: {},
      requiredSlotsByDate: {},
    };
  }
  const startDate = addDateKeyDays(dateKeys[0]!, -1);
  const endDate = addDateKeyDays(dateKeys[dateKeys.length - 1]!, 1);
  const rows = await prisma.smtInterval
    .findMany({
      where: {
        esiid: args.esiid,
        ts: {
          gte: new Date(`${startDate}T00:00:00.000Z`),
          lte: new Date(`${endDate}T23:59:59.999Z`),
        },
      },
      select: { ts: true },
      orderBy: { ts: "asc" },
    })
    .catch(() => []);
  const requestedDateSet = new Set(dateKeys);
  const { intervalsByDate, slotsByDate } = accumulateLocalCoverageByDate({ rows, requestedDateSet });
  const requiredSlotsByDate = Object.fromEntries(
    dateKeys.map((dateKey) => [dateKey, smtRequiredSlotsForDateKey(dateKey)])
  );
  const countsByDate = Object.fromEntries(
    dateKeys.map((dateKey) => [dateKey, intervalsByDate.get(dateKey)?.size ?? 0])
  );
  const distinctSlotCountByDate = Object.fromEntries(
    dateKeys.map((dateKey) => [dateKey, slotsByDate.get(dateKey)?.size ?? 0])
  );
  const missingSlotsByDate = Object.fromEntries(
    dateKeys.map((dateKey) => [
      dateKey,
      missingLocalSlotsForDate(slotsByDate.get(dateKey) ?? new Set<number>(), dateKey, SMT_HOME),
    ])
  );
  return { countsByDate, distinctSlotCountByDate, missingSlotsByDate, requiredSlotsByDate };
}

function buildDayStatus(args: {
  dateKey: string;
  intervalCount: number;
  distinctSlotCount: number;
  requiredSlots: number;
  missingSlots: number[];
  ledgerStatus: SmtDayLedgerStatus | null;
}): SmtWindowDayStatus {
  const isComplete =
    args.intervalCount >= smtCompletenessIntervalThreshold(args.requiredSlots);
  return {
    dateKey: args.dateKey,
    intervalCount: args.intervalCount,
    distinctSlotCount: args.distinctSlotCount,
    slotCount: args.intervalCount,
    requiredSlots: args.requiredSlots,
    missingSlots: args.missingSlots,
    ledgerStatus: args.ledgerStatus,
    isComplete,
  };
}

export async function loadSmtWindowDayStatus(args: {
  esiid: string;
  dateKeys?: string[];
  now?: Date;
}): Promise<SmtWindowStatusSnapshot> {
  const window = resolveSmtCanonicalWindow(args.now);
  const dateKeys = normalizeDateKeys(
    args.dateKeys ?? enumerateDateKeysInclusive(window.startDate, window.endDate)
  );
  const [{ countsByDate, distinctSlotCountByDate, missingSlotsByDate, requiredSlotsByDate }, ledger] =
    await Promise.all([
    loadChicagoSlotCountsByDateKeys({ esiid: args.esiid, dateKeys }),
    loadSmtDayLedgerSnapshot({
      esiid: args.esiid,
      canonicalStartDate: window.startDate,
      canonicalEndDate: window.endDate,
    }),
  ]);

  const byDate: Record<string, SmtWindowDayStatus> = {};
  const completeDateKeys: string[] = [];
  const incompleteDateKeys: string[] = [];

  for (const dateKey of dateKeys) {
    const requiredSlots = requiredSlotsByDate[dateKey] ?? smtRequiredSlotsForDateKey(dateKey);
    const intervalCount = countsByDate[dateKey] ?? 0;
    const day = buildDayStatus({
      dateKey,
      intervalCount,
      distinctSlotCount: distinctSlotCountByDate[dateKey] ?? 0,
      requiredSlots,
      missingSlots: missingSlotsByDate[dateKey] ?? missingLocalSlotsForDate(new Set(), dateKey, SMT_HOME),
      ledgerStatus: ledger.byDate[dateKey] ?? null,
    });
    byDate[dateKey] = day;
    if (day.isComplete) completeDateKeys.push(dateKey);
    else incompleteDateKeys.push(dateKey);
  }

  const canonicalEndDayComplete = byDate[window.endDate]?.isComplete === true;

  const pendingDateKeys: string[] = [];
  const incompleteMeterDateKeys: string[] = [];
  for (const dateKey of incompleteDateKeys) {
    const ledgerStatus = byDate[dateKey]?.ledgerStatus;
    if (ledgerStatus === SMT_DAY_LEDGER_STATUS.PENDING_SMT) {
      pendingDateKeys.push(dateKey);
    } else if (ledgerStatus === SMT_DAY_LEDGER_STATUS.INCOMPLETE_METER) {
      incompleteMeterDateKeys.push(dateKey);
    } else if (dateKey === window.endDate) {
      pendingDateKeys.push(dateKey);
    } else {
      incompleteMeterDateKeys.push(dateKey);
    }
  }

  return {
    window,
    dateKeys,
    byDate,
    completeDateKeys,
    incompleteDateKeys,
    pendingDateKeys,
    incompleteMeterDateKeys,
    canonicalEndDayComplete,
    ready: incompleteDateKeys.length === 0,
  };
}

/**
 * Ledger INCOMPLETE_METER can lag after a day becomes slot-complete (e.g. DST fall-back at 96 SMT rows).
 * Past Sim and other consumers should use the same `isComplete` rule as Usage, not stale ledger alone.
 */
export function filterLedgerIncompleteMeterDateKeysToSlotIncomplete(args: {
  incompleteMeterDateKeys: Iterable<string>;
  byDate: Readonly<Record<string, SmtWindowDayStatus>>;
}): string[] {
  const out: string[] = [];
  for (const dateKey of Array.from(args.incompleteMeterDateKeys)) {
    const dk = String(dateKey ?? "").slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dk)) continue;
    if (args.byDate[dk]?.isComplete === true) continue;
    out.push(dk);
  }
  return out;
}

/** Completeness ratio for user-facing SMT messaging (0..1), DST-aware per day. */
export function smtWindowCompletenessRatio(status: Pick<SmtWindowStatusSnapshot, "dateKeys" | "completeDateKeys">): number {
  if (status.dateKeys.length === 0) return 0;
  return status.completeDateKeys.length / status.dateKeys.length;
}

/** Persisted interval min/max mapped to Chicago coverage date keys (null when no rows). */
export async function resolveSmtPersistedCoverageSpan(esiid: string): Promise<SmtPersistedCoverageSpan | null> {
  const normalizedEsiid = String(esiid ?? "").trim();
  if (!normalizedEsiid) return null;
  const coverage = await prisma.smtInterval
    .aggregate({
      where: { esiid: normalizedEsiid },
      _min: { ts: true },
      _max: { ts: true },
    })
    .catch(() => null);
  const startDate = smtCoverageDateKey(coverage?._min?.ts ?? null);
  const endDate = smtCoverageDateKey(coverage?._max?.ts ?? null);
  if (!startDate || !endDate) return null;
  return { startDate, endDate };
}

export { enumerateExpectedLocalSlotsForDate };
