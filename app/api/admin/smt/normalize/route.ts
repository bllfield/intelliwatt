import { NextRequest, NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { GetObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { requireAdmin } from '@/lib/auth/admin';
import { prisma } from '@/lib/db';
import { normalizeSmtIntervals } from '@/app/lib/smt/normalize';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

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

export async function POST(req: NextRequest) {
  const gate = requireAdmin(req);
  if (!gate.ok) return NextResponse.json(gate.body, { status: gate.status });

  const url = new URL(req.url);
  const limitParam = Number(url.searchParams.get('limit') ?? 5);
  const limit = Number.isFinite(limitParam) ? Math.min(Math.max(Math.floor(limitParam), 1), 100) : 5;
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
    }>,
  };

  for (const file of rows) {
    let payloadBuffer: Buffer | null = null;
    if (file.content) {
      payloadBuffer = Buffer.isBuffer(file.content) ? file.content : Buffer.from(file.content as Uint8Array);
    } else {
      payloadBuffer = await getObjectFromStorage(file.storage_path);
    }

    if (!payloadBuffer) {
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

    if (!dryRun) {
      for (const interval of intervals) {
        try {
          await prisma.smtInterval.create({
            data: {
              esiid: interval.esiid,
              meter: interval.meter,
              ts: interval.ts,
              kwh: new Prisma.Decimal(interval.kwh),
              source: interval.source ?? file.source ?? 'smt',
            },
          });
          inserted += 1;
        } catch (err) {
          if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
            skipped += 1;
          } else {
            throw err;
          }
        }
      }
    } else {
      inserted = intervals.length;
    }

    summary.filesProcessed += 1;
    summary.intervalsInserted += inserted;
    summary.duplicatesSkipped += skipped;
    summary.totalKwh += stats.totalKwh;

    if (stats.tsMin && (!summary.tsMin || stats.tsMin < summary.tsMin)) summary.tsMin = stats.tsMin;
    if (stats.tsMax && (!summary.tsMax || stats.tsMax > summary.tsMax)) summary.tsMax = stats.tsMax;

    summary.files.push({
      id: String(file.id),
      filename: file.filename,
      records: intervals.length,
      inserted,
      skipped,
      kwh: Number(stats.totalKwh.toFixed(6)),
      tsMin: stats.tsMin ?? undefined,
      tsMax: stats.tsMax ?? undefined,
      diagnostics: stats,
    });
  }

  return NextResponse.json(summary);
}
