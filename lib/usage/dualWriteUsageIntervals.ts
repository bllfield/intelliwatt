import { prisma } from '@/lib/db';
import { getUsagePrisma } from '@/lib/db/usageClient';
import type { Prisma } from '@prisma/client';

export type UsageIntervalCreateInput = Prisma.UsageDataCreateManyInput;

export async function dualWriteUsageIntervals(
  data: UsageIntervalCreateInput[],
): Promise<void> {
  if (!data.length) return;

  await prisma.usageData.createMany({
    data,
    skipDuplicates: true,
  });

  try {
    const usageModule = getUsagePrisma() as any;
    if (!usageModule?.usageIntervalModule) return;

    await usageModule.usageIntervalModule.createMany({
      data: data.map((d) => ({
        id: d.id ?? undefined,
        userId: d.userId,
        source: d.source,
        interval: d.interval,
        data: d.data,
        startDate: d.startDate,
        endDate: d.endDate,
      })),
      skipDuplicates: true,
    });
  } catch (error) {
    console.error('[Usage dualWrite] module write failed', error);
  }
}

