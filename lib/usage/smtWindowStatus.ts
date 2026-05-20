import { prisma } from "@/lib/db";
import {
  CANONICAL_COVERAGE_LAG_DAYS,
  CANONICAL_COVERAGE_TOTAL_DAYS,
} from "@/lib/usage/canonicalCoverageConfig";
import { canonicalUsageWindowChicago, chicagoSlot96FromTs, enumerateDateKeysInclusive, smtCoverageDateKey } from "@/lib/time/chicago";
import {
  loadSmtDayLedgerSnapshot,
  SMT_DAY_LEDGER_STATUS,
  type SmtDayLedgerStatus,
} from "@/lib/usage/smtDayCoverageLedger";

export const SMT_REQUIRED_SLOTS_PER_DAY = 96;

export type SmtCanonicalWindow = {
  startDate: string;
  endDate: string;
};

export type SmtWindowDayStatus = {
  dateKey: string;
  slotCount: number;
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
  const win = canonicalUsageWindowChicago({
    now,
    reliableLagDays: CANONICAL_COVERAGE_LAG_DAYS,
    totalDays: CANONICAL_COVERAGE_TOTAL_DAYS,
  });
  return {
    startDate: String(win.startDate).slice(0, 10),
    endDate: String(win.endDate).slice(0, 10),
  };
}

export function missingChicagoSlotsFromFilledSlots(filledSlots: ReadonlySet<number>): number[] {
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

function accumulateChicagoSlotsByDate(args: {
  rows: Array<{ ts: Date | string | null | undefined }>;
  requestedDateSet: Set<string>;
}): Map<string, Set<number>> {
  const slotsByDate = new Map<string, Set<number>>();
  for (const row of args.rows) {
    const ts = row?.ts instanceof Date ? row.ts : row?.ts ? new Date(row.ts) : null;
    const dateKey = smtCoverageDateKey(ts);
    const slot = ts ? chicagoSlot96FromTs(ts) : null;
    if (!dateKey || slot == null || !args.requestedDateSet.has(dateKey)) continue;
    const bucket = slotsByDate.get(dateKey) ?? new Set<number>();
    bucket.add(slot);
    slotsByDate.set(dateKey, bucket);
  }
  return slotsByDate;
}

async function loadChicagoSlotCountsByDateKeys(args: {
  esiid: string;
  dateKeys: string[];
}): Promise<{
  countsByDate: Record<string, number>;
  missingSlotsByDate: Record<string, number[]>;
}> {
  const dateKeys = normalizeDateKeys(args.dateKeys);
  if (dateKeys.length === 0) {
    return { countsByDate: {}, missingSlotsByDate: {} };
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
  const slotsByDate = accumulateChicagoSlotsByDate({ rows, requestedDateSet });
  const countsByDate = Object.fromEntries(
    dateKeys.map((dateKey) => [dateKey, slotsByDate.get(dateKey)?.size ?? 0])
  );
  const missingSlotsByDate = Object.fromEntries(
    dateKeys.map((dateKey) => [
      dateKey,
      missingChicagoSlotsFromFilledSlots(slotsByDate.get(dateKey) ?? new Set<number>()),
    ])
  );
  return { countsByDate, missingSlotsByDate };
}

function buildDayStatus(args: {
  dateKey: string;
  slotCount: number;
  missingSlots: number[];
  ledgerStatus: SmtDayLedgerStatus | null;
}): SmtWindowDayStatus {
  const isComplete = args.slotCount === SMT_REQUIRED_SLOTS_PER_DAY;
  return {
    dateKey: args.dateKey,
    slotCount: args.slotCount,
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
  const [{ countsByDate, missingSlotsByDate }, ledger] = await Promise.all([
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
    const slotCount = countsByDate[dateKey] ?? 0;
    const day = buildDayStatus({
      dateKey,
      slotCount,
      missingSlots: missingSlotsByDate[dateKey] ?? missingChicagoSlotsFromFilledSlots(new Set()),
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

/** Strict 96/96 completeness ratio for user-facing SMT messaging (0..1). */
export function smtWindowCompletenessRatio(status: Pick<SmtWindowStatusSnapshot, "dateKeys" | "completeDateKeys">): number {
  if (status.dateKeys.length === 0) return 0;
  return status.completeDateKeys.length / status.dateKeys.length;
}
