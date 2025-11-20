import { NextRequest, NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import type { PrismaClient } from '@prisma/client';
import { gunzipSync } from 'zlib';
import { requireAdmin } from '@/lib/auth/admin';
import { prisma } from '@/lib/db';
import { saveRawToStorage } from '@/app/lib/storage/rawFiles';
import { normalizeSmtIntervals } from '@/app/lib/smt/normalize';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const WEBHOOK_HEADERS = ['x-intelliwatt-secret', 'x-smt-secret', 'x-webhook-secret'] as const;

async function normalizeInlineSmtCsv(opts: {
  csvBytes: Buffer;
  esiid?: string | null;
  meter?: string | null;
  source?: string | null;
}): Promise<void> {
  const { csvBytes, esiid, meter, source } = opts;
  if (!csvBytes?.length) return;

  const { intervals } = normalizeSmtIntervals(csvBytes.toString('utf8'), {
    esiid,
    meter,
    source: source ?? 'smt-inline',
  });

  if (intervals.length === 0) return;

  await prisma.smtInterval.createMany({
    data: intervals.map((interval) => ({
      esiid: interval.esiid,
      meter: interval.meter,
      ts: interval.ts,
      kwh: new Prisma.Decimal(interval.kwh),
      source: interval.source ?? 'smt-inline',
    })),
    skipDuplicates: true,
  });
}

type BillingCsvDetectionInput = {
  filename?: string | null;
  source?: string | null;
};

function looksLikeBillingCsv({ filename, source }: BillingCsvDetectionInput): boolean {
  const f = (filename || '').toLowerCase();
  const s = (source || '').toLowerCase();

  if (f.includes('interval')) return false;
  if (s.includes('interval')) return false;

  if (f.includes('dailymeterusage')) return true;
  if (f.includes('monthlybilling')) return true;
  if (f.includes('billing')) return true;
  if (f.includes('billread')) return true;

  if (s.includes('billing')) return true;
  if (s.includes('daily')) return true;

  return false;
}

type NormalizeBillingOpts = {
  prismaClient: PrismaClient;
  csvBytes: Buffer;
  esiid?: string | null;
  meter?: string | null;
  source?: string | null;
  rawSmtFileId: bigint;
  filename?: string | null;
};

type BillingRow = {
  rawSmtFileId: bigint;
  esiid: string;
  meter: string | null;
  tdspCode: string | null;
  tdspName: string | null;
  readStart: Date | null;
  readEnd: Date | null;
  billDate: Date | null;
  kwhTotal: number | null;
  kwhBilled: number | null;
  source: string | null;
};

async function maybeNormalizeBillingCsv(opts: NormalizeBillingOpts): Promise<number> {
  const { prismaClient, csvBytes, esiid, meter, source, rawSmtFileId, filename } = opts;

  if (!looksLikeBillingCsv({ filename, source })) {
    return 0;
  }

  try {
    const text = csvBytes.toString('utf8');
    const lines = text
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l.length > 0);

    if (lines.length < 2) {
      console.warn('[SMT Billing] CSV too short to parse billing reads', {
        rawSmtFileId: rawSmtFileId.toString(),
        filename,
      });
      return 0;
    }

    const headerLine = lines[0];
    const headerCells = headerLine
      .split(',')
      .map((h) => h.trim().replace(/^"|"$/g, ''));
    const headerLower = headerCells.map((h) => h.toLowerCase());

    const findCol = (...candidates: string[]): number => {
      for (const candidate of candidates) {
        const idx = headerLower.findIndex((h) => h === candidate.toLowerCase());
        if (idx !== -1) return idx;
      }
      for (const candidate of candidates) {
        const idx = headerLower.findIndex((h) => h.includes(candidate.toLowerCase()));
        if (idx !== -1) return idx;
      }
      return -1;
    };

    const dateIdx = findCol(
      'usage_date',
      'read_date',
      'readdate',
      'bill_date',
      'billing_date',
      'service_period_end',
      'period_end',
    );
    const kwhIdx = findCol('kwh', 'usage_kwh', 'total_kwh', 'billed_kwh');

    const kwhBilledIdx = findCol('kwh_billed', 'billed_kwh', 'billing_kwh', 'kwhbill');
    const periodStartIdx = findCol(
      'service_period_start',
      'period_start',
      'start_date',
      'usage_start_date',
      'read_start_date',
    );
    const periodEndIdx = findCol('service_period_end', 'period_end', 'end_date', 'usage_end_date', 'read_end_date');
    const meterIdx = findCol('meter', 'meter_number', 'meterid', 'meter_id');
    const esiidIdx = findCol('esiid', 'esiid_number', 'esi_id');
    const tdspCodeIdx = findCol('tdsp_code', 'tdsp', 'tdspid', 'tdsp_id');
    const tdspNameIdx = findCol('tdsp_name', 'tdspcompanyname', 'company_name', 'utility_name');

    if (dateIdx === -1 || kwhIdx === -1) {
      console.warn('[SMT Billing] No recognizable date/kWh columns in CSV header', {
        rawSmtFileId: rawSmtFileId.toString(),
        filename,
        header: headerCells,
      });
      return 0;
    }

    const recordsMap = new Map<string, BillingRow>();

    const parseDate = (value: string): Date | null => {
      const trimmed = value.trim().replace(/^"|"$/g, '');
      if (!trimmed) return null;
      const parsed = new Date(trimmed);
      if (Number.isNaN(parsed.getTime())) {
        return null;
      }
      return parsed;
    };

    const parseNumber = (value: string): number | null => {
      const cleaned = value.trim().replace(/^"|"$/g, '');
      if (!cleaned) return null;
      const num = Number(cleaned);
      if (!Number.isFinite(num)) return null;
      return num;
    };

    const cleanCell = (value: string | undefined | null): string => (value ?? '').trim().replace(/^"|"$/g, '');

    const targetEsiid = cleanCell(esiid ?? '');
    if (!targetEsiid) {
      console.warn('[SMT Billing] Skipping billing parse due to missing ESIID', {
        rawSmtFileId: rawSmtFileId.toString(),
        filename,
      });
      return 0;
    }

    for (let i = 1; i < lines.length; i++) {
      const line = lines[i];
      if (!line) continue;

      const cells = line.split(',');
      if (cells.length !== headerCells.length) {
        continue;
      }

      const dateRaw = cells[dateIdx] ?? '';
      const kwhRaw = cells[kwhIdx] ?? '';

      const billDate = parseDate(dateRaw);
      const kwh = parseNumber(kwhRaw);

      if (!billDate || kwh === null) {
        continue;
      }

      const billedKwh = kwhBilledIdx !== -1 ? parseNumber(cells[kwhBilledIdx] ?? '') ?? kwh : kwh;

      const rowEsiidRaw = esiidIdx !== -1 ? cleanCell(cells[esiidIdx]) : '';
      const resolvedEsiid = rowEsiidRaw || targetEsiid;

      const rowMeterRaw = meterIdx !== -1 ? cleanCell(cells[meterIdx]) : '';
      const resolvedMeter = rowMeterRaw || cleanCell(meter ?? '');

      const tdspCode = tdspCodeIdx !== -1 ? cleanCell(cells[tdspCodeIdx]) || null : null;
      const tdspName = tdspNameIdx !== -1 ? cleanCell(cells[tdspNameIdx]) || null : null;

      const readStart = periodStartIdx !== -1 ? parseDate(cells[periodStartIdx] ?? '') : null;
      const readEnd = periodEndIdx !== -1 ? parseDate(cells[periodEndIdx] ?? '') : null;

      const key = `${resolvedEsiid}::${resolvedMeter ?? ''}::${billDate.toISOString()}`;
      const existing = recordsMap.get(key);
      if (existing) {
        existing.kwhTotal = (existing.kwhTotal ?? 0) + kwh;
        existing.kwhBilled = (existing.kwhBilled ?? 0) + billedKwh;
        if (!existing.tdspCode && tdspCode) {
          existing.tdspCode = tdspCode;
        }
        if (!existing.tdspName && tdspName) {
          existing.tdspName = tdspName;
        }
        if (!existing.readStart && readStart) {
          existing.readStart = readStart;
        }
        if (!existing.readEnd && readEnd) {
          existing.readEnd = readEnd;
        }
        continue;
      }

      recordsMap.set(key, {
        rawSmtFileId,
        esiid: resolvedEsiid,
        meter: resolvedMeter ? resolvedMeter : null,
        tdspCode,
        tdspName,
        readStart: readStart ?? billDate,
        readEnd: readEnd ?? billDate,
        billDate,
        kwhTotal: kwh,
        kwhBilled: billedKwh,
        source: source ?? null,
      });
    }

    const rows = Array.from(recordsMap.values());

    if (!rows.length) {
      console.warn('[SMT Billing] No valid billing rows parsed from CSV', {
        rawSmtFileId: rawSmtFileId.toString(),
        filename,
      });
      return 0;
    }

    const billingModel = (prismaClient as any).smtBillingRead;

    await billingModel.deleteMany({
      where: { rawSmtFileId },
    });

    const result = await billingModel.createMany({
      data: rows.map((row) => ({
        ...row,
        meter: row.meter,
        tdspCode: row.tdspCode,
        tdspName: row.tdspName,
        readStart: row.readStart,
        readEnd: row.readEnd,
        billDate: row.billDate,
        kwhTotal: row.kwhTotal,
        kwhBilled: row.kwhBilled,
        source: row.source,
      })),
      skipDuplicates: true,
    });

    console.log('[SMT Billing] Parsed billing rows from CSV', {
      rawSmtFileId: rawSmtFileId.toString(),
      filename,
      rowCount: rows.length,
    });

    return (result?.count ?? rows.length) as number;
  } catch (err) {
    console.error('[SMT Billing] Error while parsing billing CSV', {
      rawSmtFileId: rawSmtFileId.toString(),
      filename,
      error: (err as Error).message,
    });
    return 0;
  }

  return 0;
}

type WebhookAuthResult =
  | { matched: true; reason: 'MATCHED'; header: string }
  | { matched: false; reason: 'SECRET_NOT_CONFIGURED' | 'HEADER_MISSING' };

function usingWebhookSecret(req: NextRequest): WebhookAuthResult {
  const secret = (process.env.INTELLIWATT_WEBHOOK_SECRET ?? process.env.DROPLET_WEBHOOK_SECRET ?? '').trim();
  if (!secret) return { matched: false, reason: 'SECRET_NOT_CONFIGURED' };
  for (const headerName of WEBHOOK_HEADERS) {
    const value = (req.headers.get(headerName) ?? '').trim();
    if (value && value === secret) {
      return { matched: true, reason: 'MATCHED', header: headerName };
    }
  }
  return { matched: false, reason: 'HEADER_MISSING' };
}

/**
 * POST /api/admin/smt/pull
 *
 * Trigger SMT pull for a given ESIID via webhook, or persist inline uploads for diagnostics.
 * Accepts either x-admin-token (interactive) or x-intelliwatt-secret (droplet webhook).
 */
export async function POST(req: NextRequest) {
  const secretCheck = usingWebhookSecret(req);
  const hasWebhookAuth = secretCheck.matched;

  if (!hasWebhookAuth) {
    const gate = requireAdmin(req);
    if (!gate.ok) {
      return NextResponse.json(gate.body, { status: gate.status });
    }
  }

  const contentType = req.headers.get('content-type') || '';
  if (!contentType.toLowerCase().includes('application/json')) {
    return NextResponse.json({ ok: false, error: 'EXPECTED_JSON' }, { status: 400 });
  }

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'BAD_JSON' }, { status: 400 });
  }

  if (body?.mode === 'inline') {
    const {
      source: rawSource = 'adhocusage',
      filename: rawFilename = 'adhoc.csv',
      mime = 'text/csv',
      encoding = 'base64',
      content_b64,
      esiid,
      meter,
      captured_at,
      sizeBytes: declaredSize,
    } = body ?? {};

    if (!content_b64) {
      return NextResponse.json({ ok: false, error: 'INLINE_MISSING_B64' }, { status: 400 });
    }

    if (encoding !== 'base64' && encoding !== 'base64+gzip') {
      return NextResponse.json(
        { ok: false, error: 'INLINE_UNSUPPORTED_ENCODING', details: `encoding "${encoding}" is not supported` },
        { status: 400 },
      );
    }

    let filename = typeof rawFilename === 'string' ? rawFilename.trim() : '';
    filename = filename.replace(/^[\\/]+/, '');
    if (!filename) {
      return NextResponse.json({ ok: false, error: 'INLINE_MISSING_FILENAME' }, { status: 400 });
    }

    let source = typeof rawSource === 'string' ? rawSource.trim() : 'adhocusage';
    source = source || 'adhocusage';

    try {
      const decoded = Buffer.from(content_b64, 'base64');
      const compressedBytes = encoding === 'base64+gzip' ? decoded.byteLength : undefined;
      const csvBytes = encoding === 'base64+gzip' ? gunzipSync(decoded) : decoded;
      const expectedSize =
        declaredSize === undefined || declaredSize === null ? undefined : Number(declaredSize);
      const computedSize = csvBytes.byteLength;
      if (expectedSize !== undefined && !Number.isNaN(expectedSize) && expectedSize !== computedSize) {
        return NextResponse.json(
          {
            ok: false,
            error: 'INLINE_SIZE_MISMATCH',
            expected: expectedSize,
            actual: computedSize,
          },
          { status: 400 },
        );
      }

      let saved;
      let billingInsertedCount: number | undefined;
      try {
        saved = await saveRawToStorage({ source, filename, mime, buf: csvBytes });
      } catch (storageError: any) {
        console.error('[smt/pull:inline] storage failed', storageError);
        return NextResponse.json(
          { ok: false, error: 'STORAGE_FAILED', detail: String(storageError?.message ?? storageError) },
          { status: 500 },
        );
      }

      const receivedAt = captured_at ? new Date(captured_at) : new Date();
      const safeReceivedAt = Number.isNaN(receivedAt.getTime()) ? new Date() : receivedAt;

      let recordId: bigint | null = null;
      let duplicate = false;
      try {
        const created = await prisma.rawSmtFile.create({
          data: {
            filename: saved.filename,
            size_bytes: saved.sizeBytes,
            sha256: saved.sha256,
            source: saved.source,
            content_type: saved.contentType,
            storage_path: saved.storagePath,
            content: csvBytes,
            received_at: safeReceivedAt,
          },
          select: { id: true },
        });
        recordId = created.id;
      } catch (err: any) {
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
          const existing = await prisma.rawSmtFile.findUnique({
            where: { sha256: saved.sha256 },
            select: { id: true },
          });
          if (existing) {
            recordId = existing.id;
            duplicate = true;
          } else {
            throw err;
          }
        } else {
          throw err;
        }
      }

      if (recordId && !duplicate) {
        const rawId = recordId;
        try {
          await normalizeInlineSmtCsv({
            csvBytes,
            esiid: typeof esiid === 'string' ? esiid : undefined,
            meter: typeof meter === 'string' ? meter : undefined,
            source: saved.source,
          });
        } catch (normalizeErr) {
          console.error('[smt/pull:inline] normalizeInlineSmtCsv failed', { id: recordId }, normalizeErr);
        }

        try {
          const inserted = await maybeNormalizeBillingCsv({
            prismaClient: prisma,
            csvBytes,
            esiid: typeof esiid === 'string' ? esiid : undefined,
            meter: typeof meter === 'string' ? meter : undefined,
            source: saved.source,
            rawSmtFileId: rawId,
            filename: saved.filename,
          });
          if (inserted > 0) {
            billingInsertedCount = inserted;
          }
        } catch (billingErr) {
          console.error('[smt/pull:inline] maybeNormalizeBillingCsv failed', { id: recordId }, billingErr);
        }
      }

      const responsePayload: Record<string, unknown> = {
        ok: true,
        mode: 'inline',
        filename: saved.filename,
        mime: saved.contentType,
        source: saved.source,
        esiid,
        meter,
        captured_at,
        sizeBytes: saved.sizeBytes,
        sha256: saved.sha256,
        storagePath: saved.storagePath,
        persisted: !duplicate,
        duplicate,
        encoding,
        id: recordId ? recordId.toString() : undefined,
        message: duplicate
          ? 'Inline payload verified (duplicate sha256, existing record reused).'
          : 'Inline payload stored and verified.',
      };

      if (compressedBytes !== undefined) {
        responsePayload.compressedBytes = compressedBytes;
      }
      if (billingInsertedCount !== undefined) {
        responsePayload.billingInserted = billingInsertedCount;
      }

      return NextResponse.json(responsePayload);
    } catch (err: any) {
      console.error('[smt/pull:inline] persistence failed', err);
      return NextResponse.json({ ok: false, error: 'INLINE_PERSIST_FAILED', detail: String(err?.message ?? err) }, { status: 500 });
    }
  }

  try {
    const { esiid, meter } = body || {};

    if (!esiid) {
      return NextResponse.json(
        { ok: false, error: 'MISSING_ESIID', details: 'esiid is required' },
        { status: 400 },
      );
    }

    const WEBHOOK_SECRET = (process.env.INTELLIWATT_WEBHOOK_SECRET ?? process.env.DROPLET_WEBHOOK_SECRET ?? '').trim();
    if (!WEBHOOK_SECRET) {
      console.error('SMT webhook missing INTELLIWATT_WEBHOOK_SECRET/DROPLET_WEBHOOK_SECRET');
      return NextResponse.json(
        { ok: false, error: 'SERVER_MISCONFIG', details: 'Missing INTELLIWATT_WEBHOOK_SECRET/DROPLET_WEBHOOK_SECRET' },
        { status: 500 },
      );
    }

    const DROPLET_WEBHOOK_URL = process.env.DROPLET_WEBHOOK_URL;
    if (!DROPLET_WEBHOOK_URL) {
      console.error('SMT webhook missing DROPLET_WEBHOOK_URL');
      return NextResponse.json(
        { ok: false, error: 'SERVER_MISCONFIG', details: 'Missing DROPLET_WEBHOOK_URL' },
        { status: 500 },
      );
    }

    let webhookResponse: Response;
    try {
      webhookResponse = await fetch(DROPLET_WEBHOOK_URL, {
        method: 'POST',
        headers: {
          [WEBHOOK_HEADERS[0]]: WEBHOOK_SECRET,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          reason: 'admin_triggered',
          esiid,
          meter: meter || undefined,
          ts: Date.now(),
        }),
        cache: 'no-store',
      });
    } catch (err: any) {
      return NextResponse.json(
        {
          ok: false,
          error: 'WEBHOOK_CONNECTION_FAILED',
          details: err?.message || 'Failed to connect to webhook',
        },
        { status: 502 },
      );
    }

    if (!webhookResponse.ok) {
      const errorText = await webhookResponse.text().catch(() => 'Unknown error');
      return NextResponse.json(
        {
          ok: false,
          error: 'WEBHOOK_FAILED',
          details: errorText,
          status: webhookResponse.status,
        },
        { status: 502 },
      );
    }

    const webhookData = await webhookResponse.json().catch(() => ({}));

    return NextResponse.json({
      ok: true,
      message: 'SMT pull triggered successfully',
      esiid,
      meter: meter || null,
      webhookResponse: webhookData,
    });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message || 'Failed to trigger SMT pull' },
      { status: 500 },
    );
  }
}

