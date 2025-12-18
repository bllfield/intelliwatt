import { NextRequest, NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { GetObjectCommand, DeleteObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { requireAdmin } from '@/lib/auth/admin';
import { prisma } from '@/lib/db';
import { usagePrisma } from '@/lib/db/usageClient';
import { ensureCoreMonthlyBuckets } from '@/lib/usage/aggregateMonthlyBuckets';
import { normalizeSmtIntervals, type NormalizeStats } from '@/app/lib/smt/normalize';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300; // allow long ingestion runs

const INSERT_BATCH_SIZE = 4000; // avoid Postgres parameter limits on large files

const s3Config = (() => {
  const bucket = process.env.S3_BUCKET;
  const endpoint = process.env.S3_ENDPOINT || process.env.DO_SPACES_ENDPOINT;
  const region = process.env.S3_REGION || 'us-east-1';
  const accessKeyId = process.env.S3_ACCESS_KEY_ID;
  const secretAccessKey = process.env.S3_SECRET_ACCESS_KEY;

  if (!bucket || !accessKeyId || !secretAccessKey) {
    return null;
  }

  return {
    bucket,
    client: new S3Client({
      region,
      endpoint,
      forcePathStyle: !!process.env.S3_FORCE_PATH_STYLE,
      credentials: {
        accessKeyId,
        secretAccessKey,
      },
    }),
  };
})();

async function getObjectFromStorage(storagePath?: string | null) {
  if (!storagePath || !s3Config) return null;
  const key = storagePath.replace(/^\//, '');

  try {
    const res = await s3Config.client.send(new GetObjectCommand({ Bucket: s3Config.bucket, Key: key }));
    const body = res.Body as unknown as { transformToByteArray?: () => Promise<Uint8Array> } | null;
    if (!body || typeof body.transformToByteArray !== 'function') return null;
    const bytes = await body.transformToByteArray();
    return Buffer.from(bytes);
  } catch (err) {
    console.error('[smt/normalize] failed to fetch object from storage', { key, err });
    return null;
  }
}

async function deleteFromStorage(storagePath?: string | null) {
  if (!storagePath || !s3Config) return false;
  const key = storagePath.replace(/^\//, '');

  try {
    await s3Config.client.send(new DeleteObjectCommand({ Bucket: s3Config.bucket, Key: key }));
    return true;
  } catch (err) {
    console.error('[smt/normalize] failed to delete object from storage', { key, err });
    return false;
  }
}

export async function POST(req: NextRequest) {
  const gate = requireAdmin(req);
  if (!gate.ok) return NextResponse.json(gate.body, { status: gate.status });

  const url = new URL(req.url);
  const purgeAll = url.searchParams.get('purge') === '1';
  const esiidFilter = url.searchParams.get('esiid')?.trim() || null;
  // Default to only the most recent file unless caller explicitly increases.
  const limitParam = Number(url.searchParams.get('limit') ?? 1);
  const limit = Number.isFinite(limitParam) ? Math.floor(limitParam) : 1;
  const cleanupOthers = url.searchParams.get('cleanup') !== '0';
  const sourceParam = url.searchParams.get('source');
  const source = sourceParam && sourceParam !== 'all' ? sourceParam : undefined;
  const dryRun = url.searchParams.get('dryRun') === '1';

  const whereFilter: any = {};

  if (source) {
    whereFilter.source = source;
  }

  if (esiidFilter) {
    whereFilter.AND = [
      {
        OR: [
          { billingReads: { some: { esiid: esiidFilter } } },
          { filename: { contains: esiidFilter } },
          { storage_path: { contains: esiidFilter } },
        ],
      },
    ];
  }

  if (purgeAll) {
    const purgeList = await prisma.rawSmtFile.findMany({
      where: whereFilter,
      select: { id: true, storage_path: true },
    });

    for (const file of purgeList) {
      if (file.storage_path) {
        await deleteFromStorage(file.storage_path);
      }
    }

    await prisma.rawSmtFile.deleteMany({ where: { id: { in: purgeList.map((f) => f.id) } } });
  }

  const rows = await prisma.rawSmtFile.findMany({
    where: whereFilter,
    orderBy: { created_at: 'desc' },
    take: limit,
    select: {
      id: true,
      filename: true,
      size_bytes: true,
      storage_path: true,
      content_type: true,
      content: true,
      source: true,
      created_at: true,
    },
  });

  const summary = {
    ok: true,
    dryRun,
    filesProcessed: 0,
    intervalsInserted: 0,
    duplicatesSkipped: 0,
    totalKwh: 0,
    tsMin: null as string | null,
    tsMax: null as string | null,
    files: [] as Array<{
      id: string;
      filename: string;
      records: number;
      inserted: number;
      skipped: number;
      kwh: number;
      tsMin?: string;
      tsMax?: string;
      diagnostics?: NormalizeStats;
    }>,
  };

  const processedIds: bigint[] = [];

  for (const file of rows) {
    // STEP 2: Prefer RawSmtFile.content (large-file SMT path), fallback to S3 for legacy records
    let payloadBuffer: Buffer | null = null;
    
    if (file.content) {
      // Large-file SMT ingestion path: content stored directly in RawSmtFile.content as Bytes
      payloadBuffer = Buffer.isBuffer(file.content) ? file.content : Buffer.from(file.content as Uint8Array);
      console.log(`[smt/normalize] using RawSmtFile.content for file ${file.id}, size=${payloadBuffer.length}`);
    } else {
      // FALLBACK: legacy path for old records that used S3 storage
      console.log(`[smt/normalize] no content, attempting S3 fetch for file ${file.id}, path=${file.storage_path}`);
      payloadBuffer = await getObjectFromStorage(file.storage_path);
    }

    if (!payloadBuffer) {
      console.warn(`[smt/normalize] no CSV content available for file ${file.id}, skipping`);
      summary.files.push({
        id: String(file.id),
        filename: file.filename,
        records: 0,
        inserted: 0,
        skipped: 0,
        kwh: 0,
      });
      continue;
    }

    const { intervals, stats } = normalizeSmtIntervals(payloadBuffer.toString('utf8'), {
      source: file.source ?? 'smt',
    });

    if (intervals.length === 0) {
      summary.files.push({
        id: String(file.id),
        filename: file.filename,
        records: 0,
        inserted: 0,
        skipped: 0,
        kwh: 0,
        tsMin: stats.tsMin ?? undefined,
        tsMax: stats.tsMax ?? undefined,
        diagnostics: stats,
      });
      continue;
    }

    let inserted = 0;
    let skipped = 0;

    // Derive tsMin/tsMax directly from parsed intervals to ensure full-file coverage
    const timestamps = intervals.map((i) => i.ts.getTime()).filter((ms) => Number.isFinite(ms));
    const tsMinDateAll = timestamps.length ? new Date(Math.min(...timestamps)) : undefined;
    const tsMaxDate = timestamps.length ? new Date(Math.max(...timestamps)) : undefined;

    // New behavior: always replace the last 365 days using the newest data
    const windowStart = tsMaxDate ? new Date(tsMaxDate.getTime() - 365 * 24 * 60 * 60 * 1000) : undefined;
    const boundedIntervals = windowStart
      ? intervals.filter((i) => i.ts >= windowStart && i.ts <= tsMaxDate!)
      : intervals;

    if (boundedIntervals.length === 0) {
      summary.files.push({
        id: String(file.id),
        filename: file.filename,
        records: 0,
        inserted: 0,
        skipped: 0,
        kwh: 0,
        tsMin: tsMinDateAll ? tsMinDateAll.toISOString() : stats.tsMin ?? undefined,
        tsMax: tsMaxDate ? tsMaxDate.toISOString() : stats.tsMax ?? undefined,
        diagnostics: stats,
      });
      continue;
    }

    const boundedTotalKwh = boundedIntervals.reduce((sum, i) => sum + i.kwh, 0);

    const distinctPairs = Array.from(new Set(boundedIntervals.map((i) => `${i.esiid}|${i.meter}`))).map((key) => {
      const [esiid, meter] = key.split('|');
      return { esiid, meter };
    });
    const distinctEsiids = Array.from(new Set(boundedIntervals.map((i) => i.esiid))).filter(Boolean);

    // Pre-group intervals by (esiid, meter) outside any DB transaction.
    // This avoids spending transaction time on CPU-heavy filtering/mapping for large files.
    const byPair = new Map<
      string,
      {
        esiid: string;
        meter: string;
        minTsMs: number;
        maxTsMs: number;
        rows: Array<{
          esiid: string;
          meter: string;
          ts: Date;
          kwh: Prisma.Decimal;
          source: string;
        }>;
      }
    >();

    for (const interval of boundedIntervals) {
      const key = `${interval.esiid}|${interval.meter}`;
      const tsMs = interval.ts.getTime();
      const existing = byPair.get(key);
      const row = {
        esiid: interval.esiid,
        meter: interval.meter,
        ts: interval.ts,
        kwh: new Prisma.Decimal(interval.kwh),
        source: interval.source ?? file.source ?? 'smt',
      };
      if (!existing) {
        byPair.set(key, {
          esiid: interval.esiid,
          meter: interval.meter,
          minTsMs: tsMs,
          maxTsMs: tsMs,
          rows: [row],
        });
      } else {
        existing.rows.push(row);
        if (Number.isFinite(tsMs)) {
          if (!Number.isFinite(existing.minTsMs) || tsMs < existing.minTsMs) existing.minTsMs = tsMs;
          if (!Number.isFinite(existing.maxTsMs) || tsMs > existing.maxTsMs) existing.maxTsMs = tsMs;
        }
      }
    }

    // Recompute bounds for the bounded set to drive delete + summary
    const boundedTimestamps = boundedIntervals.map((i) => i.ts.getTime()).filter((ms) => Number.isFinite(ms));
    const tsMinDate = boundedTimestamps.length ? new Date(Math.min(...boundedTimestamps)) : tsMinDateAll;

    if (!dryRun && tsMinDate && tsMaxDate) {
      try {
        await prisma.$transaction(
          async (tx) => {
            // For each (esiid, meter), delete the exact range then bulk insert rows.
            // Keep the transaction focused on DB work only (all grouping/mapping done above).
            for (const pair of distinctPairs) {
              const key = `${pair.esiid}|${pair.meter}`;
              const bucket = byPair.get(key);
              if (!bucket || bucket.rows.length === 0) continue;

              const pairMin = Number.isFinite(bucket.minTsMs) ? new Date(bucket.minTsMs) : tsMinDate;
              const pairMax = Number.isFinite(bucket.maxTsMs) ? new Date(bucket.maxTsMs) : tsMaxDate;

              await tx.smtInterval.deleteMany({
                where: {
                  esiid: pair.esiid,
                  meter: pair.meter,
                  ts: { gte: pairMin ?? tsMinDate, lte: pairMax ?? tsMaxDate },
                },
              });
            }

            let insertedTotal = 0;
            for (const pair of distinctPairs) {
              const key = `${pair.esiid}|${pair.meter}`;
              const bucket = byPair.get(key);
              if (!bucket || bucket.rows.length === 0) continue;

              // Chunk inserts to keep queries predictable for large SMT files.
              for (let i = 0; i < bucket.rows.length; i += INSERT_BATCH_SIZE) {
                const chunk = bucket.rows.slice(i, i + INSERT_BATCH_SIZE);
                const result = await tx.smtInterval.createMany({
                  data: chunk,
                  skipDuplicates: false,
                });
                insertedTotal += result.count;
              }
            }

            inserted = insertedTotal;
            skipped = boundedIntervals.length - insertedTotal;

            if (distinctEsiids.length > 0) {
              await tx.smtBillingRead.deleteMany({ where: { esiid: { in: distinctEsiids } } });
            }
          },
          // Prisma interactive transaction default timeout is ~5s; large SMT files can exceed this.
          // We keep the transaction narrow + chunked, but still bump timeout for safety.
          { timeout: 60_000 },
        );

        // Dual-write to usage DB so dashboards see SMT data
        try {
          const usageClient: any = usagePrisma;
          if (usageClient?.usageIntervalModule) {
            for (const pair of distinctPairs) {
              const pairIntervals = boundedIntervals.filter(
                (i) => i.esiid === pair.esiid && i.meter === pair.meter,
              );
              if (pairIntervals.length === 0) continue;

              const pairTimestamps = pairIntervals
                .map((i) => i.ts.getTime())
                .filter((ms) => Number.isFinite(ms));
              const pairMin = pairTimestamps.length ? new Date(Math.min(...pairTimestamps)) : tsMinDate;
              const pairMax = pairTimestamps.length ? new Date(Math.max(...pairTimestamps)) : tsMaxDate;

              await usageClient.usageIntervalModule.deleteMany({
                where: {
                  esiid: pair.esiid,
                  meter: pair.meter,
                  ts: { gte: pairMin ?? tsMinDate, lte: pairMax ?? tsMaxDate },
                },
              });

              await usageClient.usageIntervalModule.createMany({
                data: pairIntervals.map((interval) => ({
                  esiid: interval.esiid,
                  meter: interval.meter,
                  ts: interval.ts,
                  kwh: new Prisma.Decimal(interval.kwh),
                  filled: false,
                  source: interval.source ?? file.source ?? 'smt',
                })),
                skipDuplicates: false,
              });
            }
          }
        } catch (usageErr) {
          console.error('[smt/normalize] usage dual-write failed', usageErr);
        }
      } catch (err) {
        console.error('[smt/normalize] failed overwrite transaction', {
          fileId: file.id,
          filename: file.filename,
          tsMin: tsMinDate?.toISOString(),
          tsMax: tsMaxDate?.toISOString(),
          err,
        });
        throw err;
      }
    } else if (dryRun) {
      inserted = boundedIntervals.length;
      skipped = 0;
    }

    summary.filesProcessed += 1;
    summary.intervalsInserted += inserted;
    summary.duplicatesSkipped += skipped;
    summary.totalKwh += boundedTotalKwh;

    if (stats.tsMin && (!summary.tsMin || stats.tsMin < summary.tsMin)) summary.tsMin = stats.tsMin;
    if (stats.tsMax && (!summary.tsMax || stats.tsMax > summary.tsMax)) summary.tsMax = stats.tsMax;

    summary.files.push({
      id: String(file.id),
      filename: file.filename,
      records: boundedIntervals.length,
      inserted,
      skipped,
      kwh: Number(boundedTotalKwh.toFixed(6)),
      tsMin: tsMinDate ? tsMinDate.toISOString() : stats.tsMin ?? undefined,
      tsMax: tsMaxDate ? tsMaxDate.toISOString() : stats.tsMax ?? undefined,
      diagnostics: stats,
    });

    if (!dryRun) {
      processedIds.push(file.id);
    }

    // Also remove any existing manual/green-button data for matching homes so new SMT data is the sole source.
    if (!dryRun && distinctEsiids.length > 0) {
      try {
        const houses = await prisma.houseAddress.findMany({
          where: { esiid: { in: distinctEsiids }, archivedAt: null },
          select: { id: true, esiid: true },
        });
        const houseIds = houses.map((h) => h.id);

        if (houseIds.length > 0) {
          // Null out manualUsageId on entries tied to these houses (to avoid FK issues), then delete manual usage uploads
          const manualIds = await prisma.manualUsageUpload.findMany({ where: { houseId: { in: houseIds } }, select: { id: true } });
          if (manualIds.length > 0) {
            await prisma.entry.updateMany({ where: { manualUsageId: { in: manualIds.map((m) => m.id) } }, data: { manualUsageId: null } });
          }
          await prisma.manualUsageUpload.deleteMany({ where: { houseId: { in: houseIds } } });
          await prisma.greenButtonUpload.deleteMany({ where: { houseId: { in: houseIds } } });

          await usagePrisma.greenButtonInterval.deleteMany({ where: { homeId: { in: houseIds } } });
          await usagePrisma.rawGreenButton.deleteMany({ where: { homeId: { in: houseIds } } });
        }

        // Best-effort: ensure CORE monthly bucket totals exist for homes touched by this ingest.
        // Must never fail SMT normalization.
        try {
          const rangeEnd = tsMaxDate ?? new Date();
          const rangeStart =
            tsMinDate ?? new Date(rangeEnd.getTime() - 365 * 24 * 60 * 60 * 1000);

          for (const h of houses) {
            if (!h?.id) continue;
            await ensureCoreMonthlyBuckets({
              homeId: h.id,
              esiid: h.esiid,
              rangeStart,
              rangeEnd,
              source: "SMT",
              intervalSource: "SMT",
            });
          }
        } catch (bucketErr) {
          console.error('[smt/normalize] CORE bucket aggregation failed (best-effort)', bucketErr);
        }
      } catch (err) {
        console.error('[smt/normalize] failed to cleanup green-button/manual data for ESIID(s)', { distinctEsiids, err });
      }
    }

    // Cleanup raw file after successful normalization (mimic green-button behavior)
    if (!dryRun) {
      try {
        await prisma.rawSmtFile.delete({ where: { id: file.id } });
      } catch (err) {
        console.error('[smt/normalize] failed to delete raw record', { fileId: file.id, err });
      }

      if (file.storage_path) {
        await deleteFromStorage(file.storage_path);
      }
    }
  }

  // Optional: delete all other raw files to prevent backlog from reprocessing
  if (!dryRun && cleanupOthers && processedIds.length > 0) {
    try {
      await prisma.rawSmtFile.deleteMany({ where: { ...whereFilter, id: { notIn: processedIds } } });
    } catch (err) {
      console.error('[smt/normalize] failed to cleanup older raw files', err);
    }
  }

  return NextResponse.json(summary);
}