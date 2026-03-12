import "server-only";
import { prisma } from "@/lib/db";
import { canonicalUsageWindowChicago } from "@/lib/time/chicago";
import { getActualIntervalsForUsageShapeProfile } from "@/modules/usageShapeProfile/actualIntervals";
import { deriveUsageShapeProfile } from "@/modules/usageShapeProfile/derive";
import { upsertUsageShapeProfile } from "@/modules/usageShapeProfile/repo";
import { invalidatePastCachesForHouse } from "@/modules/usageSimulator/pastCache";

const PROFILE_VERSION = "v1";

export async function ensureUsageShapeProfileForUserHouse(args: {
  userId: string;
  houseId: string;
  timezone?: string | null;
}): Promise<
  | {
      ok: true;
      profileId: string;
      diagnostics?: {
        canonicalWindowStartDate: string;
        canonicalWindowEndDate: string;
        actualSource: "SMT" | "GREEN_BUTTON" | "NONE";
        intervalCount: number;
        derivedMonthKeyCount: number;
        profileDerivedAt?: string;
        profileSimIdentityHash?: string | null;
        dependentPastArtifactsInvalidated?: number;
        dependentPastRebuildRequired?: boolean;
      };
    }
  | { ok: false; reason: string }
> {
  const tz = String(args.timezone ?? "America/Chicago").trim() || "America/Chicago";

  const house = await prisma.houseAddress.findFirst({
    where: { id: args.houseId, userId: args.userId, archivedAt: null },
    select: { id: true, esiid: true },
  });
  if (!house) return { ok: false, reason: "house_not_found" };

  const canonicalWindow = canonicalUsageWindowChicago({ now: new Date(), reliableLagDays: 2, totalDays: 365 });
  const actual = await getActualIntervalsForUsageShapeProfile({
    houseId: house.id,
    esiid: house.esiid ?? null,
    startDate: canonicalWindow.startDate,
    endDate: canonicalWindow.endDate,
  });
  const intervals = actual.intervals;
  if (!Array.isArray(intervals) || intervals.length === 0) {
    return { ok: false, reason: "no_actual_intervals" };
  }

  const profile = deriveUsageShapeProfile(
    intervals.map((r) => ({ tsUtc: String(r.timestamp ?? ""), kwh: Number(r.kwh) || 0 })),
    tz,
    `${canonicalWindow.startDate}T00:00:00.000Z`,
    `${canonicalWindow.endDate}T23:59:59.999Z`
  );

  const saved = await upsertUsageShapeProfile(house.id, PROFILE_VERSION, profile);
  const invalidatedPastArtifactCount = await invalidatePastCachesForHouse({ houseId: house.id });
  return {
    ok: true,
    profileId: String(saved.id),
    diagnostics: {
      canonicalWindowStartDate: canonicalWindow.startDate,
      canonicalWindowEndDate: canonicalWindow.endDate,
      actualSource: actual.source,
      intervalCount: intervals.length,
      derivedMonthKeyCount: Object.keys(profile.shapeByMonth96 ?? {}).length,
      profileDerivedAt: saved.derivedAt,
      profileSimIdentityHash: saved.simIdentityHash,
      dependentPastArtifactsInvalidated: invalidatedPastArtifactCount,
      dependentPastRebuildRequired: true,
    },
  };
}

