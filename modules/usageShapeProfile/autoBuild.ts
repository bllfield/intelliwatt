import "server-only";
import { prisma } from "@/lib/db";
import { canonicalUsageWindowChicago } from "@/lib/time/chicago";
import { getActualIntervalsForRange } from "@/lib/usage/actualDatasetForHouse";
import { deriveUsageShapeProfile } from "@/modules/usageShapeProfile/derive";
import { upsertUsageShapeProfile } from "@/modules/usageShapeProfile/repo";

const PROFILE_VERSION = "v1";

export async function ensureUsageShapeProfileForUserHouse(args: {
  userId: string;
  houseId: string;
  timezone?: string | null;
}): Promise<{ ok: true; profileId: string } | { ok: false; reason: string }> {
  const tz = String(args.timezone ?? "America/Chicago").trim() || "America/Chicago";

  const house = await prisma.houseAddress.findFirst({
    where: { id: args.houseId, userId: args.userId, archivedAt: null },
    select: { id: true, esiid: true },
  });
  if (!house) return { ok: false, reason: "house_not_found" };

  const canonicalWindow = canonicalUsageWindowChicago({ now: new Date(), reliableLagDays: 2, totalDays: 365 });
  const intervals = await getActualIntervalsForRange({
    houseId: house.id,
    esiid: house.esiid ?? null,
    startDate: canonicalWindow.startDate,
    endDate: canonicalWindow.endDate,
  });
  if (!Array.isArray(intervals) || intervals.length === 0) {
    return { ok: false, reason: "no_actual_intervals" };
  }

  const firstTs = String(intervals[0]?.timestamp ?? "");
  const lastTs = String(intervals[intervals.length - 1]?.timestamp ?? "");
  const startDate = /^\d{4}-\d{2}-\d{2}/.test(firstTs) ? firstTs.slice(0, 10) : canonicalWindow.startDate;
  const endDate = /^\d{4}-\d{2}-\d{2}/.test(lastTs) ? lastTs.slice(0, 10) : canonicalWindow.endDate;

  const profile = deriveUsageShapeProfile(
    intervals.map((r) => ({ tsUtc: String(r.timestamp ?? ""), kwh: Number(r.kwh) || 0 })),
    tz,
    `${startDate}T00:00:00.000Z`,
    `${endDate}T23:59:59.999Z`
  );

  const saved = await upsertUsageShapeProfile(house.id, PROFILE_VERSION, profile);
  return { ok: true, profileId: String(saved.id) };
}

