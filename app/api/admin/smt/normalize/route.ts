import { NextRequest, NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { GetObjectCommand, DeleteObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { requireAdmin } from '@/lib/auth/admin';
import { prisma } from '@/lib/db';
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
  // Default to only the most recent file unless caller explicitly increases.
  const limitParam = Number(url.searchParams.get('limit') ?? 1);
  const limit = Number.isFinite(limitParam) ? Math.floor(limitParam) : 1;
  const source = url.searchParams.get('source') ?? 'adhocusage';
  const dryRun = url.searchParams.get('dryRun') === '1';

  const rows = await prisma.rawSmtFile.findMany({
    where: { source: source || undefined },
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

    // Recompute bounds for the bounded set to drive delete + summary
    const boundedTimestamps = boundedIntervals.map((i) => i.ts.getTime()).filter((ms) => Number.isFinite(ms));
    const tsMinDate = boundedTimestamps.length ? new Date(Math.min(...boundedTimestamps)) : tsMinDateAll;

    if (!dryRun && tsMinDate && tsMaxDate) {
          const tsMinIso = tsMinDate.toISOString();
          const tsMaxIso = tsMaxDate.toISOString();
          const distinctPairs = Array.from(new Set(boundedIntervals.map((i) => `${i.esiid}|${i.meter}`))).map((key) => {
        const [esiid, meter] = key.split('|');
        return { esiid, meter };
      });

      try {
        await prisma.$transaction(async (tx) => {
          if (distinctPairs.length > 0) {
            await tx.smtInterval.deleteMany({
              where: {
                OR: distinctPairs.map((pair) => ({
                  esiid: pair.esiid,
                  meter: pair.meter,
                  ts: {
                    gte: tsMinDate,
                    lte: tsMaxDate,
                  },
                })),
              },
            });
          }

          let insertedTotal = 0;
          for (let i = 0; i < boundedIntervals.length; i += INSERT_BATCH_SIZE) {
            const slice = boundedIntervals.slice(i, i + INSERT_BATCH_SIZE).map((interval) => ({
              esiid: interval.esiid,
              meter: interval.meter,
              ts: interval.ts,
              kwh: new Prisma.Decimal(interval.kwh),
              source: interval.source ?? file.source ?? 'smt',
            }));

            if (slice.length === 0) continue;

            const result = await tx.smtInterval.createMany({
              data: slice,
              skipDuplicates: false,
            });

            insertedTotal += result.count;
          }

          inserted = insertedTotal;
          skipped = boundedIntervals.length - insertedTotal;
        });
      } catch (err) {
        console.error('[smt/normalize] failed overwrite transaction', {
          fileId: file.id,
          filename: file.filename,
          tsMin: tsMinIso,
          tsMax: tsMaxIso,
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

  return NextResponse.json(summary);
}
