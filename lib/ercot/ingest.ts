import fs from 'node:fs';
import readline from 'node:readline';
import { prisma } from '@/lib/db';

/**
 * ERCOT TDSP ESIID extracts are typically pipe or tab delimited. We'll be permissive:
 * - Split on pipe first, else split on tab.
 * Expected columns include ESIID and service address lines; we persist raw row JSON for traceability.
 */
function splitSmart(line: string): string[] {
  if (line.includes('|')) return line.split('|');
  if (line.includes('\t')) return line.split('\t');
  return line.split(','); // fallback
}

export async function ingestLocalFile(tmpPath: string, fileSha256: string, fileUrl: string, tdspHint?: string) {
  const stream = fs.createReadStream(tmpPath);
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });

  let rowCount = 0;
  const batch: any[] = [];
  const BATCH_SIZE = 1000;

  const pushBatch = async () => {
    if (!batch.length) return;
    await prisma.ercotEsiidIndex.createMany({ data: batch, skipDuplicates: true });
    batch.length = 0;
  };

  // naive header detection
  let headers: string[] | null = null;

  for await (const line of rl) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const cols = splitSmart(trimmed);
    if (!headers) {
      headers = cols.map(c => c.trim());
      continue;
    }
    const row: Record<string, string> = {};
    for (let i = 0; i < Math.min(cols.length, headers.length); i++) {
      row[headers[i]] = cols[i]?.trim() ?? '';
    }
    const esiid = (row['ESIID'] || row['ESI ID'] || row['esiid'] || '').replace(/\D/g, '');
    if (!esiid) continue;

    const addr1 = row['SERVICE ADDRESS 1'] || row['Service Address1'] || row['ADDRESS'] || row['Service Address'] || '';
    const city = row['CITY'] || row['City'] || '';
    const state = (row['STATE'] || row['State'] || '').toLowerCase();
    const zip = (row['ZIP'] || row['Zip'] || '').trim();

    batch.push({
      esiid,
      tdspCode: tdspHint || row['TDSP'] || row['TDSP DUNS'] || '',
      serviceAddress1: addr1,
      serviceCity: city,
      serviceState: state || 'tx',
      serviceZip: zip,
    });

    rowCount++;
    if (batch.length >= BATCH_SIZE) await pushBatch();
  }

  await pushBatch();

  await prisma.ercotIngest.create({
    data: {
      status: 'ok',
      note: 'ingested',
      fileUrl,
      fileSha256,
      tdsp: tdspHint || null,
      rowCount,
    },
  });

  return { status: 'ok' as const, rowCount };
}
