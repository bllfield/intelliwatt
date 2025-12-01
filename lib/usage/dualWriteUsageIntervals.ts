import { prisma } from '@/lib/db';
import { getUsagePrisma } from '@/lib/db/usageClient';
import type { Prisma } from '@prisma/client';

export type UsageIntervalCreateInput = Prisma.SmtIntervalCreateManyInput;

export async function dualWriteUsageIntervals(
  data: UsageIntervalCreateInput[],
): Promise<void> {
  if (!data.length) {
    return;
  }

  await prisma.smtInterval.createMany({
    data,
    skipDuplicates: true,
  });

  try {
    const usageModule = getUsagePrisma() as any;
    if (!usageModule?.usageIntervalModule) {
      return;
    }

    await usageModule.usageIntervalModule.createMany({
      data: data.map((d) => ({
        id: d.id ?? undefined,
        esiid: d.esiid,
        meter: d.meter,
        ts: d.ts instanceof Date ? d.ts : new Date(d.ts),
        kwh: d.kwh,
        filled: d.filled ?? false,
        source: d.source,
      })),
      skipDuplicates: true,
    });
  } catch (error) {
    console.error('[Usage dualWrite] module write failed', error);
  }
}

