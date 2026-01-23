import { prisma } from '@/lib/db';
import { getUsagePrisma } from '@/lib/db/usageClient';
import type { Prisma } from '@prisma/client';

export type UsageIntervalCreateInput = Prisma.SmtIntervalCreateManyInput;

function chunk<T>(items: T[], size: number): T[][] {
  if (!items.length) return [];
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

export async function dualWriteUsageIntervals(
  data: UsageIntervalCreateInput[],
): Promise<void> {
  if (!data.length) {
    return;
  }

  // Insert in chunks to avoid oversized createMany payloads and reduce lock contention.
  // This still stores one row per 15-minute interval (no aggregation).
  const CHUNK_SIZE = 5000;
  for (const c of chunk(data, CHUNK_SIZE)) {
    await prisma.smtInterval.createMany({
      data: c,
      skipDuplicates: true,
    });
  }

  try {
    const usageModule = getUsagePrisma() as any;
    if (!usageModule?.usageIntervalModule) {
      return;
    }

    const mapped = data.map((d) => ({
      id: d.id ?? undefined,
      esiid: d.esiid,
      meter: d.meter,
      ts: d.ts instanceof Date ? d.ts : new Date(d.ts),
      kwh: d.kwh,
      filled: d.filled ?? false,
      source: d.source,
    }));

    for (const c of chunk(mapped, CHUNK_SIZE)) {
      await usageModule.usageIntervalModule.createMany({
        data: c,
        skipDuplicates: true,
      });
    }
  } catch (error) {
    console.error('[Usage dualWrite] module write failed', error);
  }
}

