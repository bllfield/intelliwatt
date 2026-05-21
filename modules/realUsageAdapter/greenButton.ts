import { Prisma } from "@prisma/client";
import { usagePrisma } from "@/lib/db/usageClient";
import { dateTimePartsInTimezone, enumerateDateKeysInclusive } from "@/lib/time/chicago";
import { expectedSlotsForLocalDate } from "@/lib/time/homeIntervalCalendar";
import {
  greenButtonHomeIntervalCalendar,
  greenButtonTrustedIntervalThreshold,
} from "@/lib/time/greenButtonPersistedIntervalConvert";

const DAY_MS = 24 * 60 * 60 * 1000;
const MIN_TRUSTED_GREEN_BUTTON_INTERVALS_PER_DAY = 90;
const MIN_SPLIT_GRID_GREEN_BUTTON_INTERVALS_PER_DAY = 72;
const USAGE_DB_ENABLED = Boolean((process.env.USAGE_DATABASE_URL ?? "").trim());

function parseYearMonth(ym: string): { year: number; month1: number } | null {
  const m = /^(\d{4})-(\d{2})$/.exec(String(ym ?? "").trim());
  if (!m) return null;
  const year = Number(m[1]);
  const month1 = Number(m[2]);
  if (!Number.isFinite(year) || !Number.isFinite(month1) || month1 < 1 || month1 > 12) return null;
  return { year, month1 };
}

function utcRangeWithChicagoBuffer(months: string[]): { start: Date; endExclusive: Date } {
  const first = parseYearMonth(months[0] ?? "");
  const last = parseYearMonth(months[months.length - 1] ?? "");
  if (!first || !last) {
    const now = new Date();
    return { start: new Date(now.getTime() - 370 * DAY_MS), endExclusive: new Date(now.getTime() + DAY_MS) };
  }

  // Buffer ensures we cover the full Chicago-local window even across DST boundaries.
  const start = new Date(Date.UTC(first.year, first.month1 - 1, 1, 0, 0, 0, 0) - DAY_MS);
  const endExclusive = new Date(Date.UTC(last.year, last.month1, 1, 0, 0, 0, 0) + 2 * DAY_MS);
  return { start, endExclusive };
}

function chicagoYearMonthFromBucket(bucket: Date): string {
  return dateTimePartsInTimezone(bucket, "America/Chicago")?.yearMonth ?? bucket.toISOString().slice(0, 7);
}

function chicagoDateKeyFromBucket(bucket: Date): string {
  return dateTimePartsInTimezone(bucket, "America/Chicago")?.dateKey ?? bucket.toISOString().slice(0, 10);
}

function chicagoDateKeyFromIsoTimestamp(timestamp: string): string | null {
  const parsed = new Date(timestamp);
  if (!Number.isFinite(parsed.getTime())) return null;
  return dateTimePartsInTimezone(parsed, "America/Chicago")?.dateKey ?? parsed.toISOString().slice(0, 10);
}

function chicagoSlot96FromIsoTimestamp(timestamp: string): number | null {
  const parsed = new Date(timestamp);
  if (!Number.isFinite(parsed.getTime())) return null;
  const parts = dateTimePartsInTimezone(parsed, "America/Chicago");
  if (!parts) return null;
  const slot = parts.hour * 4 + Math.floor(parts.minute / 15);
  return Number.isFinite(slot) && slot >= 0 && slot < 96 ? slot : null;
}

function utcDateKeyFromIsoTimestamp(timestamp: string): string | null {
  const parsed = new Date(timestamp);
  if (!Number.isFinite(parsed.getTime())) return null;
  return parsed.toISOString().slice(0, 10);
}

function utcSlot96FromIsoTimestamp(timestamp: string): number | null {
  const parsed = new Date(timestamp);
  if (!Number.isFinite(parsed.getTime())) return null;
  const slot = parsed.getUTCHours() * 4 + Math.floor(parsed.getUTCMinutes() / 15);
  return Number.isFinite(slot) && slot >= 0 && slot < 96 ? slot : null;
}

function utcGridTimestampForDateSlot(dateKey: string, slot: number): string {
  return new Date(new Date(`${dateKey}T00:00:00.000Z`).getTime() + slot * 15 * 60 * 1000).toISOString();
}

function minimumTrustedGreenButtonSlotCount(dateKey: string): number {
  return greenButtonTrustedIntervalThreshold(dateKey);
}

function normalizeDateKey(value: unknown): string | null {
  const text = String(value ?? "").slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : null;
}

function shiftDateKeyByDays(dateKey: string, days: number): string {
  const parsed = new Date(`${dateKey}T12:00:00.000Z`);
  return new Date(parsed.getTime() + days * DAY_MS).toISOString().slice(0, 10);
}

function neighboringDateKeys(dateKey: string): string[] {
  return [shiftDateKeyByDays(dateKey, -1), dateKey, shiftDateKeyByDays(dateKey, 1)];
}

function shiftIsoTimestampByWholeYears(timestamp: string, years: number): string | null {
  const parsed = new Date(timestamp);
  if (!Number.isFinite(parsed.getTime())) return null;
  const targetYear = parsed.getUTCFullYear() + years;
  const monthIndex = parsed.getUTCMonth();
  const clampedDay = Math.min(parsed.getUTCDate(), new Date(Date.UTC(targetYear, monthIndex + 1, 0)).getUTCDate());
  return new Date(
    Date.UTC(
      targetYear,
      monthIndex,
      clampedDay,
      parsed.getUTCHours(),
      parsed.getUTCMinutes(),
      parsed.getUTCSeconds(),
      parsed.getUTCMilliseconds()
    )
  ).toISOString();
}

function shiftDateKeyByWholeYears(dateKey: string, years: number): string | null {
  const normalized = normalizeDateKey(dateKey);
  if (!normalized) return null;
  const parsed = new Date(`${normalized}T12:00:00.000Z`);
  if (!Number.isFinite(parsed.getTime())) return null;
  const targetYear = parsed.getUTCFullYear() + years;
  const monthIndex = parsed.getUTCMonth();
  const clampedDay = Math.min(parsed.getUTCDate(), new Date(Date.UTC(targetYear, monthIndex + 1, 0)).getUTCDate());
  return new Date(Date.UTC(targetYear, monthIndex, clampedDay, 12, 0, 0, 0)).toISOString().slice(0, 10);
}

function coverageWindowFromCanonicalMonths(months: string[]): { startDate: string; endDate: string } | null {
  const first = parseYearMonth(months[0] ?? "");
  const last = parseYearMonth(months[months.length - 1] ?? "");
  if (!first || !last) return null;
  const lastDay = new Date(Date.UTC(last.year, last.month1, 0)).getUTCDate();
  return {
    startDate: `${String(first.year)}-${String(first.month1).padStart(2, "0")}-01`,
    endDate: `${String(last.year)}-${String(last.month1).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`,
  };
}

function resolveSourceCoverageWindowFromAnchorEnd(anchorEndDate: string): { startDate: string; endDate: string } | null {
  const normalizedEnd = normalizeDateKey(anchorEndDate);
  if (!normalizedEnd) return null;
  return {
    startDate: shiftDateKeyByDays(normalizedEnd, -364),
    endDate: normalizedEnd,
  };
}

export type GreenButtonCoverageWindowIntervals = {
  intervals: Array<{ timestamp: string; kwh: number }>;
  intervalsCount: number;
  sourceCoverageStart: string | null;
  sourceCoverageEnd: string | null;
  shiftedIntervalCount: number;
  shiftedDateCount: number;
  paddedIntervalCount?: number;
  paddedDateCount?: number;
  repairedDuplicateIntervalCount?: number;
  repairedDuplicateDateCount?: number;
  sourceDateByTargetDate?: Record<string, string>;
  trustedActualDateKeys?: string[];
  displayWindowNote: string | null;
};

function excludeDateKeysFragment(excludeDateKeys: string[] | undefined): Prisma.Sql {
  if (!excludeDateKeys?.length) return Prisma.sql``;
  return Prisma.sql` AND to_char(("timestamp" AT TIME ZONE 'America/Chicago')::timestamp, 'YYYY-MM-DD') NOT IN (${Prisma.join(excludeDateKeys.map((d) => Prisma.sql`${d}`), ", ")})`;
}

function travelRangesToExcludeDateKeys(ranges: Array<{ startDate: string; endDate: string }> | undefined): string[] {
  if (!ranges?.length) return [];
  const set = new Set<string>();
  const re = /^\d{4}-\d{2}-\d{2}$/;
  for (const r of ranges) {
    if (!re.test(String(r.startDate).trim()) || !re.test(String(r.endDate).trim())) continue;
    const dateKeys = enumerateDateKeysInclusive(String(r.startDate).trim(), String(r.endDate).trim());
    for (let i = 0; i < dateKeys.length; i += 1) set.add(dateKeys[i]!);
  }
  return Array.from(set);
}

async function latestRawGreenButtonIdForHouse(houseId: string): Promise<string | null> {
  if (!USAGE_DB_ENABLED) return null;
  try {
    const usageClient = usagePrisma as any;
    const latestUsableRawByUploadIdentity = (await usageClient.$queryRaw(Prisma.sql`
      SELECT r."id"
      FROM "RawGreenButton" r
      WHERE r."homeId" = ${houseId}
        AND EXISTS (
          SELECT 1
          FROM "GreenButtonInterval" i
          WHERE i."homeId" = ${houseId}
            AND i."rawId" = r."id"
        )
      ORDER BY r."createdAt" DESC
      LIMIT 1
    `)) as Array<{ id: string }>;
    if (latestUsableRawByUploadIdentity?.[0]?.id) return String(latestUsableRawByUploadIdentity[0].id);

    const latestUsableRawFromIntervals = (await usageClient.$queryRaw(Prisma.sql`
      SELECT i."rawId" AS "id", MAX(i."timestamp") AS "latestTimestamp"
      FROM "GreenButtonInterval" i
      WHERE i."homeId" = ${houseId}
      GROUP BY i."rawId"
      ORDER BY MAX(i."timestamp") DESC
      LIMIT 1
    `)) as Array<{ id: string }>;
    if (latestUsableRawFromIntervals?.[0]?.id) return String(latestUsableRawFromIntervals[0].id);

    const latestRaw = await usageClient.rawGreenButton.findFirst({
      where: { homeId: houseId },
      orderBy: { createdAt: "desc" },
      select: { id: true },
    });
    return latestRaw?.id ? String(latestRaw.id) : null;
  } catch {
    return null;
  }
}

export async function getLatestUsableRawGreenButtonIdForHouse(houseId: string): Promise<string | null> {
  return latestRawGreenButtonIdForHouse(houseId);
}

export async function getLatestGreenButtonIntervalTimestamp(args: { houseId: string }): Promise<Date | null> {
  if (!USAGE_DB_ENABLED) return null;
  const rawId = await latestRawGreenButtonIdForHouse(args.houseId);
  if (!rawId) return null;
  try {
    const usageClient = usagePrisma as any;
    const latest = await usageClient.greenButtonInterval.findFirst({
      where: { homeId: args.houseId, rawId },
      orderBy: { timestamp: "desc" },
      select: { timestamp: true },
    });
    return latest?.timestamp ?? null;
  } catch {
    return null;
  }
}

export async function getLatestGreenButtonFullDayDateKey(args: { houseId: string }): Promise<string | null> {
  if (!USAGE_DB_ENABLED) return null;
  const rawId = await latestRawGreenButtonIdForHouse(args.houseId);
  if (!rawId) return null;
  try {
    const usageClient = usagePrisma as any;
    const rows = (await usageClient.$queryRaw(Prisma.sql`
      SELECT
        date_trunc('day', ("timestamp" AT TIME ZONE 'America/Chicago')) AT TIME ZONE 'America/Chicago' AS bucket,
        COUNT(*)::int AS intervalscount
      FROM "GreenButtonInterval"
      WHERE "homeId" = ${args.houseId}
        AND "rawId" = ${rawId}
      GROUP BY bucket
      ORDER BY bucket DESC
      LIMIT 35
    `)) as Array<{ bucket: Date; intervalscount: number }>;
    for (const row of rows) {
      const dateKey = chicagoDateKeyFromBucket(row.bucket);
      const expectedIntervals = expectedSlotsForLocalDate(dateKey, greenButtonHomeIntervalCalendar());
      if ((Number(row.intervalscount) || 0) >= expectedIntervals) return dateKey;
    }
    if (rows[0]?.bucket) return chicagoDateKeyFromBucket(rows[0].bucket);
    return null;
  } catch {
    return null;
  }
}

export async function fetchGreenButtonIntervalsForCoverageWindow(args: {
  houseId: string;
  coverageStartDate: string;
  coverageEndDate: string;
  excludeDateKeys?: string[];
  travelRanges?: Array<{ startDate: string; endDate: string }>;
  timestampMode?: "raw" | "utcDayGrid";
}): Promise<GreenButtonCoverageWindowIntervals> {
  const coverageStartDate = normalizeDateKey(args.coverageStartDate);
  const coverageEndDate = normalizeDateKey(args.coverageEndDate);
  if (!USAGE_DB_ENABLED || !coverageStartDate || !coverageEndDate || coverageStartDate > coverageEndDate) {
    return {
      intervals: [],
      intervalsCount: 0,
      sourceCoverageStart: null,
      sourceCoverageEnd: null,
      shiftedIntervalCount: 0,
      shiftedDateCount: 0,
      sourceDateByTargetDate: {},
      displayWindowNote: null,
    };
  }
  const rawId = await latestRawGreenButtonIdForHouse(args.houseId);
  if (!rawId) {
    return {
      intervals: [],
      intervalsCount: 0,
      sourceCoverageStart: null,
      sourceCoverageEnd: null,
      shiftedIntervalCount: 0,
      shiftedDateCount: 0,
      sourceDateByTargetDate: {},
      displayWindowNote: null,
    };
  }
  const anchorEndDate = await getLatestGreenButtonFullDayDateKey({ houseId: args.houseId });
  const sourceCoverageWindow = anchorEndDate ? resolveSourceCoverageWindowFromAnchorEnd(anchorEndDate) : null;
  if (!sourceCoverageWindow) {
    return {
      intervals: [],
      intervalsCount: 0,
      sourceCoverageStart: null,
      sourceCoverageEnd: null,
      shiftedIntervalCount: 0,
      shiftedDateCount: 0,
      sourceDateByTargetDate: {},
      displayWindowNote: null,
    };
  }

  const start = new Date(`${sourceCoverageWindow.startDate}T00:00:00.000Z`);
  const endExclusive = new Date(new Date(`${sourceCoverageWindow.endDate}T00:00:00.000Z`).getTime() + 2 * DAY_MS);
  const mergedExclude = [
    ...(args.excludeDateKeys ?? []),
    ...travelRangesToExcludeDateKeys(args.travelRanges),
  ]
    .map((dateKey) => normalizeDateKey(dateKey))
    .filter((dateKey): dateKey is string => dateKey != null);
  const excludeTargetDateKeys = new Set<string>(mergedExclude);

  try {
    const usageClient = usagePrisma as any;
    const rows = (await usageClient.$queryRaw(Prisma.sql`
      SELECT "timestamp" AS ts, "consumptionKwh"::float AS kwh
      FROM "GreenButtonInterval"
      WHERE "homeId" = ${args.houseId}
        AND "rawId" = ${rawId}
        AND "timestamp" >= ${start}
        AND "timestamp" < ${endExclusive}
      ORDER BY "timestamp" ASC
    `)) as Array<{ ts: Date; kwh: number }>;

    const byTimestamp = new Map<string, number>();
    const shiftedDateKeys = new Set<string>();
    const sourceSlotCountsByDate = new Map<string, number>();
    const sourceSlotsByDate = new Map<string, Set<number>>();
    const canonicalSourceSlotsByDate = new Map<string, Set<number>>();
    const trustedShiftedSourceDateByTargetDate = new Map<string, string>();
    const sourceDateByTargetDate = new Map<string, string>();
    const targetSlotsByDate = new Map<string, Set<number>>();
    const targetSlotValuesByDate = new Map<string, Map<number, number[]>>();
    const currentTrustedTargetDateResets = new Set<string>();
    let shiftedIntervalCount = 0;
    let paddedIntervalCount = 0;
    let paddedDateCount = 0;
    let repairedDuplicateIntervalCount = 0;
    let repairedDuplicateDateCount = 0;

    const resolveUtcGridTargetDate = (sourceDateKey: string): { targetDateKey: string; yearsShifted: number } | null => {
      let targetDateKey = sourceDateKey;
      let yearsShifted = 0;
      while (targetDateKey < coverageStartDate) {
        const advanced = shiftDateKeyByWholeYears(sourceDateKey, yearsShifted + 1);
        if (!advanced || advanced === targetDateKey) break;
        targetDateKey = advanced;
        yearsShifted += 1;
      }
      if (yearsShifted === 0 && sourceDateKey > sourceCoverageWindow.endDate) return null;
      if (targetDateKey < coverageStartDate || targetDateKey > coverageEndDate) return null;
      if (excludeTargetDateKeys.has(targetDateKey)) return null;
      return { targetDateKey, yearsShifted };
    };

    const canonicalSourceSlotCountForUtcGridDate = (sourceDateKey: string, fallbackSlotCount: number): number => {
      let bestCanonicalSlotCount = 0;
      for (const candidateDateKey of neighboringDateKeys(sourceDateKey)) {
        bestCanonicalSlotCount = Math.max(
          bestCanonicalSlotCount,
          canonicalSourceSlotsByDate.get(candidateDateKey)?.size ?? 0
        );
      }
      if (bestCanonicalSlotCount < minimumTrustedGreenButtonSlotCount(sourceDateKey)) return fallbackSlotCount;
      // A trusted Chicago-local source day can split across adjacent UTC-grid days.
      // Require substantial UTC-grid coverage so an isolated partial day does not get padded as trusted.
      if (fallbackSlotCount < MIN_SPLIT_GRID_GREEN_BUTTON_INTERVALS_PER_DAY) return fallbackSlotCount;
      return bestCanonicalSlotCount;
    };

    if (args.timestampMode === "utcDayGrid") {
      for (const row of rows) {
        const rawTimestamp = (row.ts instanceof Date ? row.ts : new Date(row.ts)).toISOString();
        const sourceDateKey = utcDateKeyFromIsoTimestamp(rawTimestamp);
        const sourceSlot = utcSlot96FromIsoTimestamp(rawTimestamp);
        if (!sourceDateKey || sourceSlot == null) continue;
        const slots = sourceSlotsByDate.get(sourceDateKey) ?? new Set<number>();
        slots.add(sourceSlot);
        sourceSlotsByDate.set(sourceDateKey, slots);

        const canonicalSourceDateKey = chicagoDateKeyFromIsoTimestamp(rawTimestamp);
        const canonicalSourceSlot = chicagoSlot96FromIsoTimestamp(rawTimestamp);
        if (canonicalSourceDateKey && canonicalSourceSlot != null) {
          const canonicalSlots = canonicalSourceSlotsByDate.get(canonicalSourceDateKey) ?? new Set<number>();
          canonicalSlots.add(canonicalSourceSlot);
          canonicalSourceSlotsByDate.set(canonicalSourceDateKey, canonicalSlots);
        }
      }
      for (const [sourceDateKey, slots] of Array.from(sourceSlotsByDate.entries())) {
        sourceSlotCountsByDate.set(sourceDateKey, slots.size);
        const canonicalSourceSlotCount = canonicalSourceSlotCountForUtcGridDate(sourceDateKey, slots.size);
        if (canonicalSourceSlotCount < minimumTrustedGreenButtonSlotCount(sourceDateKey)) continue;
        const resolved = resolveUtcGridTargetDate(sourceDateKey);
        if (!resolved || resolved.yearsShifted <= 0) continue;
        const targetDateSourceSlots = sourceSlotsByDate.get(resolved.targetDateKey);
        if (
          targetDateSourceSlots &&
          targetDateSourceSlots.size >= minimumTrustedGreenButtonSlotCount(resolved.targetDateKey)
        ) {
          continue;
        }
        if (!trustedShiftedSourceDateByTargetDate.has(resolved.targetDateKey)) {
          trustedShiftedSourceDateByTargetDate.set(resolved.targetDateKey, sourceDateKey);
        }
      }
    }

    for (const row of rows) {
      const rawTimestamp = (row.ts instanceof Date ? row.ts : new Date(row.ts)).toISOString();
      const sourceDateKey =
        args.timestampMode === "utcDayGrid"
          ? utcDateKeyFromIsoTimestamp(rawTimestamp)
          : chicagoDateKeyFromIsoTimestamp(rawTimestamp);
      if (!sourceDateKey) continue;
      const sourceSlot =
        args.timestampMode === "utcDayGrid"
          ? utcSlot96FromIsoTimestamp(rawTimestamp)
          : chicagoSlot96FromIsoTimestamp(rawTimestamp);
      if (args.timestampMode !== "utcDayGrid") {
        sourceSlotCountsByDate.set(sourceDateKey, (sourceSlotCountsByDate.get(sourceDateKey) ?? 0) + 1);
      }
      if (args.timestampMode === "utcDayGrid") {
        if (sourceSlot == null) continue;
        const resolvedTarget = resolveUtcGridTargetDate(sourceDateKey);
        if (!resolvedTarget) continue;
        const { targetDateKey, yearsShifted } = resolvedTarget;
        const trustedShiftedSourceDateKey = trustedShiftedSourceDateByTargetDate.get(targetDateKey);
        if (trustedShiftedSourceDateKey && trustedShiftedSourceDateKey !== sourceDateKey) continue;
        if (yearsShifted > 0) {
          shiftedIntervalCount += 1;
          shiftedDateKeys.add(targetDateKey);
        }
        const existingSourceDateKey = sourceDateByTargetDate.get(targetDateKey);
        if (
          existingSourceDateKey &&
          existingSourceDateKey !== sourceDateKey &&
          existingSourceDateKey !== targetDateKey &&
          sourceDateKey === targetDateKey
        ) {
          const existingSourceSlotCount = sourceSlotCountsByDate.get(existingSourceDateKey) ?? 0;
          const currentSourceSlotCount = sourceSlotCountsByDate.get(sourceDateKey) ?? 0;
          if (existingSourceSlotCount >= minimumTrustedGreenButtonSlotCount(existingSourceDateKey)) {
            if (currentSourceSlotCount < minimumTrustedGreenButtonSlotCount(sourceDateKey)) continue;
            if (!currentTrustedTargetDateResets.has(targetDateKey)) {
              for (let slot = 0; slot < 96; slot += 1) {
                byTimestamp.delete(utcGridTimestampForDateSlot(targetDateKey, slot));
              }
              targetSlotsByDate.set(targetDateKey, new Set<number>());
              targetSlotValuesByDate.set(targetDateKey, new Map<number, number[]>());
              currentTrustedTargetDateResets.add(targetDateKey);
            }
          }
        }
        const outputTimestamp = utcGridTimestampForDateSlot(targetDateKey, sourceSlot);
        byTimestamp.set(outputTimestamp, (byTimestamp.get(outputTimestamp) ?? 0) + (Number(row.kwh) || 0));
        sourceDateByTargetDate.set(targetDateKey, sourceDateKey);
        const targetSlots = targetSlotsByDate.get(targetDateKey) ?? new Set<number>();
        targetSlots.add(sourceSlot);
        targetSlotsByDate.set(targetDateKey, targetSlots);
        const slotValues = targetSlotValuesByDate.get(targetDateKey) ?? new Map<number, number[]>();
        const values = slotValues.get(sourceSlot) ?? [];
        values.push(Number(row.kwh) || 0);
        slotValues.set(sourceSlot, values);
        targetSlotValuesByDate.set(targetDateKey, slotValues);
        continue;
      }
      let rebasedTimestamp = rawTimestamp;
      let targetDateKey = sourceDateKey;
      let shifted = false;
      while (targetDateKey < coverageStartDate) {
        const advanced = shiftIsoTimestampByWholeYears(rebasedTimestamp, 1);
        if (!advanced || advanced === rebasedTimestamp) break;
        rebasedTimestamp = advanced;
        const nextDateKey = chicagoDateKeyFromIsoTimestamp(rebasedTimestamp);
        if (!nextDateKey) break;
        targetDateKey = nextDateKey;
        shifted = true;
      }
      if (!targetDateKey || targetDateKey < coverageStartDate || targetDateKey > coverageEndDate) continue;
      if (excludeTargetDateKeys.has(targetDateKey)) continue;
      if (shifted) {
        shiftedIntervalCount += 1;
        shiftedDateKeys.add(targetDateKey);
      }
      sourceDateByTargetDate.set(targetDateKey, sourceDateKey);
      byTimestamp.set(rebasedTimestamp, (byTimestamp.get(rebasedTimestamp) ?? 0) + (Number(row.kwh) || 0));
    }

    if (args.timestampMode === "utcDayGrid") {
      for (const [targetDateKey, slotValues] of Array.from(targetSlotValuesByDate.entries())) {
        const slots = targetSlotsByDate.get(targetDateKey);
        if (!slots) continue;
        const missingSlots = Array.from({ length: 96 }, (_, slot) => slot).filter((slot) => !slots.has(slot));
        if (missingSlots.length === 0) continue;
        const duplicateExtras: number[] = [];
        for (const [slot, values] of Array.from(slotValues.entries()).sort(([left], [right]) => left - right)) {
          if (values.length <= 1) continue;
          const timestamp = utcGridTimestampForDateSlot(targetDateKey, slot);
          byTimestamp.set(timestamp, values[0] ?? 0);
          duplicateExtras.push(...values.slice(1));
        }
        if (duplicateExtras.length === 0) continue;
        let repairedThisDate = 0;
        for (const slot of missingSlots) {
          const value = duplicateExtras.shift();
          if (value == null) break;
          const timestamp = utcGridTimestampForDateSlot(targetDateKey, slot);
          byTimestamp.set(timestamp, value);
          slots.add(slot);
          repairedDuplicateIntervalCount += 1;
          repairedThisDate += 1;
        }
        if (repairedThisDate > 0) repairedDuplicateDateCount += 1;
      }

      for (const [targetDateKey, slots] of Array.from(targetSlotsByDate.entries())) {
        if (slots.size === 0 || slots.size >= 96) continue;
        const sourceDateKey = sourceDateByTargetDate.get(targetDateKey);
        if (!sourceDateKey) continue;
        const sourceSlotCount = sourceSlotCountsByDate.get(sourceDateKey) ?? 0;
        const canonicalSourceSlotCount = canonicalSourceSlotCountForUtcGridDate(sourceDateKey, sourceSlotCount);
        // Some Green Button exports land on the UTC Past Sim grid with a repeated
        // one-hour gap after local-time/year rebasing. Keep those high-coverage
        // actual days actual, but do not hide genuinely sparse partial days.
        const minimumSourceCompleteSlotCount = minimumTrustedGreenButtonSlotCount(sourceDateKey);
        if (canonicalSourceSlotCount < minimumSourceCompleteSlotCount) continue;

        let paddedThisDate = 0;
        for (let slot = 0; slot < 96; slot += 1) {
          if (slots.has(slot)) continue;
          const timestamp = utcGridTimestampForDateSlot(targetDateKey, slot);
          if (byTimestamp.has(timestamp)) continue;
          byTimestamp.set(timestamp, 0);
          paddedIntervalCount += 1;
          paddedThisDate += 1;
        }
        if (paddedThisDate > 0) paddedDateCount += 1;
      }
    }

    const intervals = Array.from(byTimestamp.entries())
      .map(([timestamp, kwh]) => ({
        timestamp,
        kwh: Number(kwh) || 0,
      }))
      .sort((left, right) => (left.timestamp < right.timestamp ? -1 : left.timestamp > right.timestamp ? 1 : 0));
    const displayWindowNote =
      shiftedIntervalCount > 0
        ? "Historical Green Button intervals and their matching source-day weather were shifted into the current coverage window so available actual data stays in the Past Sim pool up to the current date. Travel/Vacant dates remain excluded."
        : null;

    return {
      intervals,
      intervalsCount: intervals.length,
      sourceCoverageStart: sourceCoverageWindow.startDate,
      sourceCoverageEnd: sourceCoverageWindow.endDate,
      shiftedIntervalCount,
      shiftedDateCount: shiftedDateKeys.size,
      paddedIntervalCount,
      paddedDateCount,
      repairedDuplicateIntervalCount,
      repairedDuplicateDateCount,
      sourceDateByTargetDate: Object.fromEntries(
        Array.from(sourceDateByTargetDate.entries()).sort(([left], [right]) => left.localeCompare(right))
      ),
      trustedActualDateKeys: Array.from(trustedShiftedSourceDateByTargetDate.keys()).sort((left, right) =>
        left.localeCompare(right)
      ),
      displayWindowNote,
    };
  } catch {
    return {
      intervals: [],
      intervalsCount: 0,
      sourceCoverageStart: sourceCoverageWindow.startDate,
      sourceCoverageEnd: sourceCoverageWindow.endDate,
      shiftedIntervalCount: 0,
      shiftedDateCount: 0,
      sourceDateByTargetDate: {},
      trustedActualDateKeys: [],
      displayWindowNote: null,
    };
  }
}

export async function hasGreenButtonIntervals(args: { houseId: string; canonicalMonths: string[] }): Promise<boolean> {
  const coverageWindow = coverageWindowFromCanonicalMonths(args.canonicalMonths);
  if (!coverageWindow) return false;
  const rebased = await fetchGreenButtonIntervalsForCoverageWindow({
    houseId: args.houseId,
    coverageStartDate: coverageWindow.startDate,
    coverageEndDate: coverageWindow.endDate,
  });
  return rebased.intervalsCount > 0;
}

export async function fetchGreenButtonCanonicalMonthlyTotals(args: {
  houseId: string;
  canonicalMonths: string[];
  excludeDateKeys?: string[];
  travelRanges?: Array<{ startDate: string; endDate: string }>;
}) {
  const coverageWindow = coverageWindowFromCanonicalMonths(args.canonicalMonths);
  if (!coverageWindow) return { intervalsCount: 0, monthlyKwhByMonth: {} as Record<string, number> };
  try {
    const rebased = await fetchGreenButtonIntervalsForCoverageWindow({
      houseId: args.houseId,
      coverageStartDate: coverageWindow.startDate,
      coverageEndDate: coverageWindow.endDate,
      excludeDateKeys: args.excludeDateKeys,
      travelRanges: args.travelRanges,
    });
    const monthSet = new Set(args.canonicalMonths);
    const monthlyKwhByMonth: Record<string, number> = {};
    for (const row of rebased.intervals) {
      const parts = dateTimePartsInTimezone(new Date(row.timestamp), "America/Chicago");
      const yearMonth = parts?.yearMonth ?? row.timestamp.slice(0, 7);
      if (!monthSet.has(yearMonth)) continue;
      monthlyKwhByMonth[yearMonth] = (monthlyKwhByMonth[yearMonth] ?? 0) + (Number(row.kwh) || 0);
    }
    return { intervalsCount: rebased.intervalsCount, monthlyKwhByMonth };
  } catch {
    return { intervalsCount: 0, monthlyKwhByMonth: {} as Record<string, number> };
  }
}

export async function fetchGreenButtonCanonicalDailyTotals(args: {
  houseId: string;
  canonicalMonths: string[];
}) {
  const coverageWindow = coverageWindowFromCanonicalMonths(args.canonicalMonths);
  if (!coverageWindow) return { intervalsCount: 0, dailyKwhByDateKey: {} as Record<string, number> };
  try {
    const rebased = await fetchGreenButtonIntervalsForCoverageWindow({
      houseId: args.houseId,
      coverageStartDate: coverageWindow.startDate,
      coverageEndDate: coverageWindow.endDate,
    });
    const dailyKwhByDateKey: Record<string, number> = {};
    for (const row of rebased.intervals) {
      const dateKey = chicagoDateKeyFromIsoTimestamp(row.timestamp);
      if (!dateKey) continue;
      dailyKwhByDateKey[dateKey] = (dailyKwhByDateKey[dateKey] ?? 0) + (Number(row.kwh) || 0);
    }
    return { intervalsCount: rebased.intervalsCount, dailyKwhByDateKey };
  } catch {
    return { intervalsCount: 0, dailyKwhByDateKey: {} as Record<string, number> };
  }
}

export async function fetchGreenButtonIntradayShape96(args: {
  houseId: string;
  canonicalMonths: string[];
  excludeDateKeys?: string[];
  travelRanges?: Array<{ startDate: string; endDate: string }>;
}): Promise<number[] | null> {
  const coverageWindow = coverageWindowFromCanonicalMonths(args.canonicalMonths);
  if (!coverageWindow) return null;
  try {
    const rebased = await fetchGreenButtonIntervalsForCoverageWindow({
      houseId: args.houseId,
      coverageStartDate: coverageWindow.startDate,
      coverageEndDate: coverageWindow.endDate,
      excludeDateKeys: args.excludeDateKeys,
      travelRanges: args.travelRanges,
    });
    const vec = Array.from({ length: 96 }, () => 0);
    let total = 0;
    for (const row of rebased.intervals) {
      const parts = dateTimePartsInTimezone(new Date(row.timestamp), "America/Chicago");
      if (!parts) continue;
      const bucket = parts.hour * 4 + Math.floor(parts.minute / 15);
      if (!Number.isFinite(bucket) || bucket < 0 || bucket >= 96) continue;
      const kwh = Number(row.kwh) || 0;
      vec[bucket] += kwh;
      total += kwh;
    }
    if (total <= 0) return null;
    return vec.map((value) => value / total);
  } catch {
    return null;
  }
}

