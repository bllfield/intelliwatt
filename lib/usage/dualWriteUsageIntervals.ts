import { prisma } from '@/lib/db';
import { getUsagePrisma } from '@/lib/db/usageClient';
import { Prisma } from '@prisma/client';

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

  const clean = (value: unknown): string => String(value ?? '').trim();
  const cleanMeter = (value: unknown): string => {
    const s = clean(value);
    return s.length ? s : 'unknown';
  };

  // Normalize obvious whitespace differences and de-dupe within this batch by (esiid, ts).
  // Important: SMT re-syncs can arrive with different meter IDs (e.g., first pass "unknown",
  // later pass with the true meter number). We canonicalize per-ESIID so we don't double-insert
  // the same timestamps under a different meter key.
  const byEsiid = new Map<string, UsageIntervalCreateInput[]>();
  for (const row of data) {
    const esiid = clean((row as any)?.esiid);
    if (!esiid) continue;
    const ts = (row as any)?.ts;
    const tsDate = ts instanceof Date ? ts : new Date(ts);
    if (Number.isNaN(tsDate.getTime())) continue;
    const meter = cleanMeter((row as any)?.meter);

    const normalized: UsageIntervalCreateInput = {
      ...(row as any),
      esiid,
      meter,
      ts: tsDate,
    };

    const arr = byEsiid.get(esiid) ?? [];
    arr.push(normalized);
    byEsiid.set(esiid, arr);
  }

  const canonicalMeterByEsiid = new Map<string, string>();

  for (const [esiid, rows] of byEsiid.entries()) {
    const incomingMeters = Array.from(
      new Set(rows.map((r) => cleanMeter((r as any)?.meter))),
    );

    const existingDistinct = await prisma.smtInterval
      .findMany({
        where: { esiid },
        distinct: ['meter'],
        select: { meter: true },
        take: 10,
      })
      .catch(() => [] as Array<{ meter: string }>);

    const existingMeters = existingDistinct.map((r) => cleanMeter(r.meter));
    const existingNonUnknown = existingMeters.filter((m) => m !== 'unknown');
    const incomingNonUnknown = incomingMeters.filter((m) => m !== 'unknown');

    const canonical = (() => {
      if (existingMeters.length === 1) return existingMeters[0];
      if (existingNonUnknown.length >= 1) return existingNonUnknown[0];
      if (incomingNonUnknown.length >= 1) return incomingNonUnknown[0];
      return 'unknown';
    })();

    canonicalMeterByEsiid.set(esiid, canonical);

    // If we previously ingested with meter='unknown' only, and now we know the true meter,
    // upgrade existing rows in-place to avoid future ambiguity (safe because no other meters exist yet).
    if (existingMeters.length === 1 && existingMeters[0] === 'unknown' && canonical !== 'unknown') {
      await prisma.smtInterval
        .updateMany({
          where: { esiid, meter: 'unknown' },
          data: { meter: canonical },
        })
        .catch(() => null);
    }

    // If duplicates already exist (unknown + real meter), aggressively delete the unknown copies
    // when a non-unknown record exists for the same timestamp.
    if (existingMeters.includes('unknown') && existingMeters.some((m) => m !== 'unknown')) {
      await prisma
        .$executeRaw(Prisma.sql`
          DELETE FROM "SmtInterval" u
          USING "SmtInterval" r
          WHERE u."esiid" = ${esiid}
            AND u."meter" = 'unknown'
            AND r."esiid" = u."esiid"
            AND r."ts" = u."ts"
            AND r."meter" <> u."meter"
        `)
        .catch(() => null);
    }
  }

  // Apply canonical meter and de-dupe within-batch by (esiid, meter, ts).
  const normalizedData: UsageIntervalCreateInput[] = [];
  const seen = new Set<string>();
  for (const [esiid, rows] of byEsiid.entries()) {
    const canonicalMeter = canonicalMeterByEsiid.get(esiid) ?? 'unknown';
    for (const row of rows) {
      const ts = (row as any).ts as Date;
      const key = `${esiid}::${canonicalMeter}::${ts.toISOString()}`;
      if (seen.has(key)) continue;
      seen.add(key);
      normalizedData.push({ ...(row as any), meter: canonicalMeter });
    }
  }

  // Insert in chunks to avoid oversized createMany payloads and reduce lock contention.
  // This still stores one row per 15-minute interval (no aggregation).
  const CHUNK_SIZE = 5000;
  for (const c of chunk(normalizedData, CHUNK_SIZE)) {
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

    const mapped = normalizedData.map((d) => ({
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

