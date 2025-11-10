import crypto from 'node:crypto';
import { prisma } from '@/lib/db';

type FetchLike = (url: string) => Promise<Response>;

function sha256(buf: Buffer | string) {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

/**
 * Download a daily ERCOT export (placeholder).
 * Replace URL logic with the real source when ready.
 */
export async function fetchErcotDailyExport(fetcher: FetchLike, dateISO?: string) {
  // TODO: swap this placeholder with real ERCOT URL selection
  const url = process.env.ERCOT_PAGE_URL || 'https://example.com/ercot/daily-export.csv';
  const res = await fetcher(url);

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`ERCOT fetch failed ${res.status}: ${text.slice(0, 500)}`);
  }

  const arrayBuf = await res.arrayBuffer();
  const buf = Buffer.from(arrayBuf);
  return { url, buf };
}

/** Very light CSV sniff (replace with a real parser when wiring live) */
function parseCsvLines(buf: Buffer) {
  const text = buf.toString('utf8');
  const lines = text.split(/\r?\n/).filter(Boolean);
  const [header, ...rows] = lines;
  const cols = header.split(',').map(s => s.trim());
  const items = rows.map((line) => {
    const vals = line.split(',');
    const obj: Record<string, string> = {};
    cols.forEach((c, i) => (obj[c] = (vals[i] ?? '').trim()));
    return obj;
  });
  return { cols, items };
}

/** Normalize a raw record to our ErcotEsiidIndex shape (adjust mapping later) */
function normalizeRecord(raw: Record<string, string>) {
  const rec = {
    esiid: raw.ESIID || raw.ESI_ID || raw.esiid || '',
    meterNumber: raw.Meter || raw.METER || raw.meter || null,
    serviceAddress1: raw.ServiceAddress1 || raw.SERVICE_ADDRESS_1 || raw.Address1 || null,
    serviceAddress2: raw.ServiceAddress2 || raw.SERVICE_ADDRESS_2 || raw.Address2 || null,
    city: raw.City || raw.CITY || raw.city || null,
    state: (raw.State || raw.STATE || raw.state || '').toLowerCase() || null,
    zip: raw.Zip || raw.ZIP || raw.zip || null,
    county: raw.County || raw.COUNTY || raw.county || null,
    premiseType: raw.PremiseType || raw.PREMISE_TYPE || raw.premise_type || null,
    status: raw.Status || raw.STATUS || raw.status || null,
    tdspName: raw.TDSP || raw.TDSPName || raw.TDSP_NAME || raw.tdsp || null,
    tdspCode: null as string | null,
    utilityName: raw.Utility || raw.UTILITY || raw.utility || null,
    utilityId: raw.UtilityId || raw.UTILITY_ID || raw.utility_id || null,
    raw,
  };

  if (!rec.esiid || rec.esiid.length < 10) return null;
  return rec;
}

export async function upsertEsiidRecords(items: Array<Record<string, string>>) {
  let seen = 0, upserted = 0;

  for (const r of items) {
    seen++;
    const n = normalizeRecord(r);
    if (!n) continue;

    try {
      await prisma.ercotEsiidIndex.upsert({
        where: { esiid: n.esiid },
        create: n,
        update: {
          // update only fields we're comfortable refreshing regularly
          meterNumber: n.meterNumber ?? undefined,
          serviceAddress1: n.serviceAddress1 ?? undefined,
          serviceAddress2: n.serviceAddress2 ?? undefined,
          city: n.city ?? undefined,
          state: n.state ?? undefined,
          zip: n.zip ?? undefined,
          county: n.county ?? undefined,
          premiseType: n.premiseType ?? undefined,
          status: n.status ?? undefined,
          tdspName: n.tdspName ?? undefined,
          utilityName: n.utilityName ?? undefined,
          utilityId: n.utilityId ?? undefined,
          raw: n.raw ?? undefined,
        },
      });
      upserted++;
    } catch {
      // swallow and continue; we log at the batch level
    }
  }

  return { seen, upserted };
}

export async function runErcotIngest(fetcher: FetchLike = fetch) {
  const startedAt = new Date();
  let ingestId: string | undefined;
  let fileHash = '';
  let sourceUrl = '';
  let recordsSeen = 0;
  let recordsUpserted = 0;

  try {
    const { url, buf } = await fetchErcotDailyExport(fetcher);
    sourceUrl = url;
    fileHash = sha256(buf);

    // Idempotence: bail if we've already processed this hash
    const existing = await prisma.ercotIngest.findUnique({ where: { fileHash } });
    if (existing) {
      return {
        ok: true,
        id: existing.id,
        status: 'noop',
        message: 'Already ingested',
        fileHash,
        sourceUrl,
      };
    }

    const ingest = await prisma.ercotIngest.create({
      data: {
        fileHash,
        sourceUrl,
        startedAt,
        status: 'pending',
      },
      select: { id: true },
    });
    ingestId = ingest.id;

    const { items } = parseCsvLines(buf);
    const { seen, upserted } = await upsertEsiidRecords(items);
    recordsSeen = seen;
    recordsUpserted = upserted;

    await prisma.ercotIngest.update({
      where: { id: ingest.id },
      data: {
        finishedAt: new Date(),
        status: 'success',
        recordsSeen,
        recordsUpserted,
      },
    });

    return {
      ok: true,
      id: ingest.id,
      status: 'success',
      fileHash,
      sourceUrl,
      seen: recordsSeen,
      upserted: recordsUpserted,
    };
  } catch (err: any) {
    if (ingestId) {
      await prisma.ercotIngest.update({
        where: { id: ingestId },
        data: {
          finishedAt: new Date(),
          status: 'error',
          errorMessage: err?.message?.slice(0, 1000) || 'unknown error',
        },
      });
    } else {
      // create a failed record so we can see it in admin
      await prisma.ercotIngest.create({
        data: {
          fileHash: fileHash || null,
          sourceUrl: sourceUrl || null,
          startedAt,
          finishedAt: new Date(),
          status: 'error',
          errorMessage: err?.message?.slice(0, 1000) || 'unknown error',
        },
      });
    }

    return { ok: false, status: 'error', error: err?.message || 'unknown error' };
  }
}

