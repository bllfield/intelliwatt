import { prisma } from '@/lib/db';
import { getUsagePrisma } from '@/lib/db/usageClient';

import { Prisma } from '@prisma/client';

export type UsageSourceFilter = {
  houseId?: string;
  esiid?: string;
  source?: 'smt' | 'green_button' | 'manual' | 'other';
  start?: Date;
  end?: Date;
};

export type NormalizedUsageRow = {
  houseId: string | null;
  esiid: string | null;
  meter: string;
  timestamp: Date;
  kwh: number;
  source: string;
  rawSourceId: string;
};

type UsagePrismaClient = ReturnType<typeof getUsagePrisma>;
type RawUsageRow = Awaited<
  ReturnType<UsagePrismaClient['usageIntervalModule']['findMany']>
>[number] & { houseId?: string | null };

function buildUsageWhere(filter: UsageSourceFilter) {
  const where: Record<string, unknown> = {};

  if (filter.esiid) {
    where.esiid = filter.esiid.trim();
  }

  if (filter.source) {
    where.source = filter.source;
  }

  if (filter.start || filter.end) {
    where.ts = {
      ...(filter.start ? { gte: filter.start } : {}),
      ...(filter.end ? { lte: filter.end } : {}),
    };
  }

  return where;
}

export async function loadRawUsageForHouse(
  filter: UsageSourceFilter,
): Promise<RawUsageRow[]> {
  const usagePrisma = getUsagePrisma();

  const rows = await usagePrisma.usageIntervalModule.findMany({
    where: buildUsageWhere(filter),
    orderBy: { ts: 'asc' },
  });

  return rows;
}

function mapRawToNormalized(row: RawUsageRow, filter: UsageSourceFilter): NormalizedUsageRow {
  const meter = row.meter?.trim();
  if (!meter) {
    throw new Error('Raw usage row is missing meter identifier (row.id=' + row.id + ').');
  }

  const houseId = filter.houseId ?? row.houseId ?? null;
  const esiid = row.esiid ?? filter.esiid ?? null;
  const source = filter.source ?? row.source ?? 'smt';

  return {
    houseId,
    esiid,
    meter,
    timestamp: row.ts,
    kwh: Number(row.kwh),
    source,
    rawSourceId: row.id,
  };
}

function chunkArray<T>(items: T[], size: number): T[][] {
  if (items.length === 0) return [];
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

const UPSERT_CHUNK_SIZE = 250;

function normalizedKey(row: NormalizedUsageRow): string {
  return `${row.esiid ?? ''}::${row.meter}::${row.timestamp.toISOString()}`;
}

async function upsertNormalizedChunk(
  chunk: NormalizedUsageRow[],
): Promise<{ inserted: number; updated: number }> {
  if (chunk.length === 0) {
    return { inserted: 0, updated: 0 };
  }

  const uniqueKeys = chunk.map((row) => ({
    esiid: row.esiid ?? '',
    meter: row.meter,
    ts: row.timestamp,
  }));

  const existing = await prisma.smtInterval.findMany({
    where: {
      OR: uniqueKeys.map((key) => ({
        esiid: key.esiid,
        meter: key.meter,
        ts: key.ts,
      })),
    },
    select: {
      esiid: true,
      meter: true,
      ts: true,
    },
  });

  const existingSet = new Set(
    existing.map((row) => normalizedKey({
      houseId: null,
      esiid: row.esiid,
      meter: row.meter,
      timestamp: row.ts,
      kwh: 0,
      source: '',
      rawSourceId: '',
    })),
  );

  await prisma.$transaction(
    chunk.map((row) =>
      prisma.smtInterval.upsert({
        where: {
          esiid_meter_ts: {
            esiid: row.esiid ?? '',
            meter: row.meter,
            ts: row.timestamp,
          },
        },
        create: {
          esiid: row.esiid ?? '',
          meter: row.meter,
          ts: row.timestamp,
          kwh: new Prisma.Decimal(row.kwh),
          source: row.source,
        },
        update: {
          kwh: new Prisma.Decimal(row.kwh),
          source: row.source,
        },
      }),
    ),
  );

  const inserted = chunk.filter((row) => !existingSet.has(normalizedKey(row))).length;
  const updated = chunk.length - inserted;

  return { inserted, updated };
}

export async function normalizeRawUsageToMaster(
  filter: UsageSourceFilter,
) {
  const rawRows = await loadRawUsageForHouse(filter);

  if (rawRows.length === 0) {
    return {
      ok: true as const,
      rawCount: 0,
      insertedCount: 0,
      updatedCount: 0,
    };
  }

  const normalizedRows = rawRows.map((row) => mapRawToNormalized(row, filter));

  let insertedCount = 0;
  let updatedCount = 0;

  const chunks = chunkArray(normalizedRows, UPSERT_CHUNK_SIZE);
  for (const chunk of chunks) {
    const { inserted, updated } = await upsertNormalizedChunk(chunk);
    insertedCount += inserted;
    updatedCount += updated;
  }

  return {
    ok: true as const,
    rawCount: rawRows.length,
    insertedCount,
    updatedCount,
  };
}

