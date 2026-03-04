import { usagePrisma } from "@/lib/db/usageClient";
import type { DerivedUsageShapeProfile } from "./derive";

export async function upsertUsageShapeProfile(
  houseId: string,
  version: string,
  profile: DerivedUsageShapeProfile
): Promise<{ id: string }> {
  const windowStartUtc = new Date(profile.windowStartUtc);
  const windowEndUtc = new Date(profile.windowEndUtc);

  const existing = await usagePrisma.usageShapeProfile.findUnique({
    where: { houseId_version: { houseId, version } },
    select: { id: true },
  });

  const data = {
    windowStartUtc,
    windowEndUtc,
    baseloadKwhPer15m: profile.baseloadKwhPer15m,
    baseloadKwhPerDay: profile.baseloadKwhPerDay,
    shapeAll96: profile.shapeAll96 as any,
    shapeWeekday96: profile.shapeWeekday96 as any,
    shapeWeekend96: profile.shapeWeekend96 as any,
    shapeByMonth96: profile.shapeByMonth96 as any,
    avgKwhPerDayWeekdayByMonth: profile.avgKwhPerDayWeekdayByMonth as any,
    avgKwhPerDayWeekendByMonth: profile.avgKwhPerDayWeekendByMonth as any,
    peakHourByMonth: profile.peakHourByMonth as any,
    p95KwByMonth: profile.p95KwByMonth as any,
    timeOfDayShares: profile.timeOfDayShares as any,
    configHash: profile.configHash,
  };

  if (existing) {
    await usagePrisma.usageShapeProfile.update({
      where: { id: existing.id },
      data,
    });
    return { id: existing.id };
  }

  const created = await usagePrisma.usageShapeProfile.create({
    data: {
      houseId,
      version,
      ...data,
    },
    select: { id: true },
  });
  return { id: created.id };
}

export async function getLatestUsageShapeProfile(houseId: string) {
  return usagePrisma.usageShapeProfile.findFirst({
    where: { houseId },
    orderBy: { derivedAt: "desc" },
  });
}
