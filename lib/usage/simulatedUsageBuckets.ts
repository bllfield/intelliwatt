import { usagePrisma } from "@/lib/db/usageClient";
import { canonicalizeMonthlyBucketKey } from "@/lib/plan-engine/usageBuckets";
import { ensureBucketsExist } from "@/lib/usage/aggregateMonthlyBuckets";

export type UsageBucketsByMonth = Record<string, Record<string, number>>;

/**
 * Upsert simulated usage buckets for a house/scenario (Past or Future).
 * Call after building the simulated dataset so plan costing can use these buckets.
 */
export async function upsertSimulatedUsageBuckets(args: {
  homeId: string;
  scenarioKey: string; // "PAST" | "FUTURE" or scenario id
  scenarioId?: string | null;
  usageBucketsByMonth: UsageBucketsByMonth;
  source?: string;
}): Promise<{ rowsUpserted: number }> {
  const source = args.source ?? "SIMULATED";
  const keysToWrite = new Set<string>();
  for (const buckets of Object.values(args.usageBucketsByMonth ?? {})) {
    for (const key of Object.keys(buckets ?? {})) {
      const c = canonicalizeMonthlyBucketKey(String(key).trim());
      if (c) keysToWrite.add(c);
    }
  }
  if (keysToWrite.size > 0) {
    await ensureBucketsExist({ bucketKeys: Array.from(keysToWrite) }).catch(() => {});
  }

  let rowsUpserted = 0;
  const client = usagePrisma as any;

  for (const [yearMonth, buckets] of Object.entries(args.usageBucketsByMonth ?? {})) {
    const ym = String(yearMonth).trim();
    if (!/^\d{4}-\d{2}$/.test(ym)) continue;
    for (const [key, kwh] of Object.entries(buckets ?? {})) {
      const bucketKey = canonicalizeMonthlyBucketKey(String(key).trim());
      if (!bucketKey || typeof kwh !== "number" || !Number.isFinite(kwh) || kwh < 0) continue;
      try {
        await client.homeSimulatedUsageBucket.upsert({
          where: {
            homeId_scenarioKey_yearMonth_bucketKey: {
              homeId: args.homeId,
              scenarioKey: args.scenarioKey,
              yearMonth: ym,
              bucketKey,
            },
          },
          create: {
            homeId: args.homeId,
            scenarioKey: args.scenarioKey,
            scenarioId: args.scenarioId ?? null,
            yearMonth: ym,
            bucketKey,
            kwhTotal: kwh,
            source,
          },
          update: {
            ...(args.scenarioId != null ? { scenarioId: args.scenarioId } : {}),
            kwhTotal: kwh,
            source,
            computedAt: new Date(),
          },
        });
        rowsUpserted++;
      } catch (_) {
        // best-effort; skip on constraint or client errors
      }
    }
  }
  return { rowsUpserted };
}

/**
 * Load simulated usage buckets for a house/scenario (e.g. for plan costing when scenario is Past/Future).
 */
export async function getSimulatedUsageBucketsForHouse(args: {
  homeId: string;
  scenarioKey: string;
}): Promise<UsageBucketsByMonth | null> {
  const client = usagePrisma as any;
  const rows = await client.homeSimulatedUsageBucket
    .findMany({
      where: { homeId: args.homeId, scenarioKey: args.scenarioKey },
      select: { yearMonth: true, bucketKey: true, kwhTotal: true },
    })
    .catch(() => []);
  if (!Array.isArray(rows) || rows.length === 0) return null;
  const out: UsageBucketsByMonth = {};
  for (const r of rows) {
    const ym = String((r as any)?.yearMonth ?? "").trim();
    const key = canonicalizeMonthlyBucketKey(String((r as any)?.bucketKey ?? "").trim());
    const kwh = Number((r as any)?.kwhTotal);
    if (!ym || !key || !Number.isFinite(kwh)) continue;
    if (!out[ym]) out[ym] = {};
    out[ym][key] = kwh;
  }
  return Object.keys(out).length > 0 ? out : null;
}
