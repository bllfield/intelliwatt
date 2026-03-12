import { usagePrisma } from "@/lib/db/usageClient";
import type { DerivedUsageShapeProfile } from "./derive";
import { createHash } from "crypto";

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map((v) => stableStringify(v)).join(",")}]`;
  if (value && typeof value === "object") {
    const obj = value as Record<string, unknown>;
    const keys = Object.keys(obj).sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

export function computeUsageShapeProfileSimIdentityHash(
  profile:
    | Pick<
        DerivedUsageShapeProfile,
        | "baseloadKwhPer15m"
        | "baseloadKwhPerDay"
        | "shapeAll96"
        | "shapeWeekday96"
        | "shapeWeekend96"
        | "shapeByMonth96"
        | "avgKwhPerDayWeekdayByMonth"
        | "avgKwhPerDayWeekendByMonth"
        | "peakHourByMonth"
        | "p95KwByMonth"
        | "timeOfDayShares"
        | "configHash"
      >
    | null
    | undefined
): string | null {
  if (!profile) return null;
  const canonical = {
    baseloadKwhPer15m: profile.baseloadKwhPer15m ?? null,
    baseloadKwhPerDay: profile.baseloadKwhPerDay ?? null,
    shapeAll96: profile.shapeAll96 ?? [],
    shapeWeekday96: profile.shapeWeekday96 ?? [],
    shapeWeekend96: profile.shapeWeekend96 ?? [],
    shapeByMonth96: profile.shapeByMonth96 ?? {},
    avgKwhPerDayWeekdayByMonth: profile.avgKwhPerDayWeekdayByMonth ?? [],
    avgKwhPerDayWeekendByMonth: profile.avgKwhPerDayWeekendByMonth ?? [],
    peakHourByMonth: profile.peakHourByMonth ?? [],
    p95KwByMonth: profile.p95KwByMonth ?? [],
    timeOfDayShares: profile.timeOfDayShares ?? {},
    configHash: profile.configHash ?? "",
  };
  return createHash("sha256").update(stableStringify(canonical), "utf8").digest("hex");
}

export async function upsertUsageShapeProfile(
  houseId: string,
  version: string,
  profile: DerivedUsageShapeProfile
): Promise<{ id: string; derivedAt: string; simIdentityHash: string | null }> {
  const windowStartUtc = new Date(profile.windowStartUtc);
  const windowEndUtc = new Date(profile.windowEndUtc);
  const nextDerivedAt = new Date();
  const simIdentityHash = computeUsageShapeProfileSimIdentityHash(profile);

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
      data: {
        ...data,
        // Bump derivedAt on refresh so downstream cache identities cannot silently stay stale.
        derivedAt: nextDerivedAt,
      },
    });
    return { id: existing.id, derivedAt: nextDerivedAt.toISOString(), simIdentityHash };
  }

  const created = await usagePrisma.usageShapeProfile.create({
    data: {
      houseId,
      version,
      derivedAt: nextDerivedAt,
      ...data,
    },
    select: { id: true },
  });
  return { id: created.id, derivedAt: nextDerivedAt.toISOString(), simIdentityHash };
}

export async function getLatestUsageShapeProfile(houseId: string) {
  return usagePrisma.usageShapeProfile.findFirst({
    where: { houseId },
    orderBy: { derivedAt: "desc" },
  });
}
