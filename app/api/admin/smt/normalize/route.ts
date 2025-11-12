import { NextRequest, NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { GetObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { requireAdmin } from '@/lib/auth/admin';
import { prisma } from '@/lib/db';
import { parseSmtCsvFlexible } from '@/lib/smt/parseCsv';
import { groupNormalize, type NormalizedPoint, type SmtAdhocRow } from '@/lib/analysis/normalizeSmt';

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

function toAdhocRows(parsed: ReturnType<typeof parseSmtCsvFlexible>): SmtAdhocRow[] {
  const rows: SmtAdhocRow[] = [];

  for (const entry of parsed) {
    if (!entry) continue;
    if (entry.kwh == null) continue;

    let timestamp = entry.endLocal ?? entry.dateTimeLocal ?? null;
    if (!timestamp && entry.startLocal) {
      const startDate = new Date(entry.startLocal);
      if (!Number.isNaN(startDate.getTime())) {
        const endDate = new Date(startDate.getTime() + 15 * 60 * 1000);
        timestamp = endDate.toISOString();
      } else {
        timestamp = entry.startLocal;
      }
    }

    if (!timestamp) continue;

    rows.push({
      esiid: entry.esiid ?? undefined,
      meter: entry.meter ?? undefined,
      timestamp,
      kwh: entry.kwh ?? undefined,
    });
  }

  return rows;
}

function summarizePoints(esiid: string, meter: string, points: NormalizedPoint[]) {
  const intervals: Array<{ esiid: string; meter: string; ts: Date; kwh: number }> = [];
  let tsMin: string | null = null;
  let tsMax: string | null = null;
  let totalKwh = 0;

  for (const point of points) {
    if (!point || typeof point.kwh !== 'number' || !Number.isFinite(point.kwh)) continue;
    const date = new Date(point.ts);
    if (Number.isNaN(date.getTime())) continue;
    intervals.push({ esiid, meter, ts: date, kwh: point.kwh });
    totalKwh += point.kwh;
    if (!tsMin || point.ts < tsMin) tsMin = point.ts;
    if (!tsMax || point.ts > tsMax) tsMax = point.ts;
  }

  return { intervals, tsMin, tsMax, totalKwh };
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

    const csvText = payloadBuffer.toString('utf8');
    const parsed = parseSmtCsvFlexible(csvText);
    const adhocRows = toAdhocRows(parsed);

    if (adhocRows.length === 0) {
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

    const grouped = groupNormalize(adhocRows, 'esiid_meter', { tz: 'America/Chicago' });
    const fileIntervals: Array<{ esiid: string; meter: string; ts: Date; kwh: number }> = [];
    let fileKwh = 0;
    let fileTsMin: string | null = null;
    let fileTsMax: string | null = null;

    for (const [composite, { points }] of Object.entries(grouped.groups)) {
      const [esiid, meter] = composite.split('|');
      const summaryForGroup = summarizePoints(esiid || 'unknown', meter || 'unknown', points);
      fileIntervals.push(...summaryForGroup.intervals);
      fileKwh += summaryForGroup.totalKwh;
      if (summaryForGroup.tsMin && (!fileTsMin || summaryForGroup.tsMin < fileTsMin)) fileTsMin = summaryForGroup.tsMin;
      if (summaryForGroup.tsMax && (!fileTsMax || summaryForGroup.tsMax > fileTsMax)) fileTsMax = summaryForGroup.tsMax;
    }

    let inserted = 0;
    let skipped = 0;

    if (!dryRun) {
      for (const interval of fileIntervals) {
        try {
          await prisma.smtInterval.create({
            data: {
              esiid: interval.esiid,
              meter: interval.meter,
              ts: interval.ts,
              kwh: new Prisma.Decimal(interval.kwh),
              source: file.source ?? 'smt',
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
      inserted = fileIntervals.length;
    }

    summary.filesProcessed += 1;
    summary.intervalsInserted += inserted;
    summary.duplicatesSkipped += skipped;
    summary.totalKwh += fileKwh;

    if (fileTsMin && (!summary.tsMin || fileTsMin < summary.tsMin)) summary.tsMin = fileTsMin;
    if (fileTsMax && (!summary.tsMax || fileTsMax > summary.tsMax)) summary.tsMax = fileTsMax;

    summary.files.push({
      id: String(file.id),
      filename: file.filename,
      records: fileIntervals.length,
      inserted,
      skipped,
      kwh: Number(fileKwh.toFixed(6)),
      tsMin: fileTsMin ?? undefined,
      tsMax: fileTsMax ?? undefined,
    });
  }

  return NextResponse.json(summary);
}
