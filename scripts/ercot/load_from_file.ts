import dotenv from 'dotenv';
dotenv.config({ path: '.env.local', override: false });
dotenv.config({ path: '.env', override: false });

import crypto from 'crypto';
import { existsSync, readFileSync } from 'fs';
import path from 'path';
import { PrismaClient } from '@prisma/client';
import { sniffFormat, iterRows, sanitize } from '../../lib/ercot/fileFormat';
import { normalizeAddress } from '../../lib/ercot/normalize';
import { pathToFileURL } from 'url';

const BATCH_SIZE = 1000;
const REQUIRED_COLS = ['ESIID', 'TDSP_CODE', 'SERVICE_ADDRESS1', 'SERVICE_CITY', 'SERVICE_STATE', 'SERVICE_ZIP'];
const COLUMN_ALIASES: Record<string, string[]> = {
  ESIID: ['ESIID', 'ESI_ID', 'ESI ID'],
  TDSP_CODE: ['TDSP_CODE', 'TDSP', 'TDSP CODE'],
  SERVICE_ADDRESS1: ['SERVICE_ADDRESS1', 'SERVICE_ADDRESS', 'ADDRESS1', 'SERVICE_STREET', 'STREET_ADDR1'],
  SERVICE_CITY: ['SERVICE_CITY', 'CITY', 'SERVICECITY'],
  SERVICE_STATE: ['SERVICE_STATE', 'STATE'],
  SERVICE_ZIP: ['SERVICE_ZIP', 'ZIP', 'ZIP_CODE', 'POSTAL_CODE'],
  STATUS: ['STATUS', 'ESIID_STATUS'],
  PREMISE_TYPE: ['PREMISE_TYPE', 'PREMISECLASS', 'CLASS'],
  POSTED_DATE: ['POSTED_DATE', 'RUN_DATE', 'FILE_DATE'],
};

type Canon = {
  ESIID: string;
  TDSP_CODE?: string;
  SERVICE_ADDRESS1?: string;
  SERVICE_CITY?: string;
  SERVICE_STATE?: string;
  SERVICE_ZIP?: string;
  STATUS?: string;
  PREMISE_TYPE?: string;
  POSTED_DATE?: string;
};

function usage() {
  console.log(`
Usage:
  npx tsx scripts/ercot/load_from_file.ts --file /path/to/TDSP_ESIID_Extract.txt [--notes "first run"]

This parses a local ERCOT TDSP ESIID file (pipe/csv/tsv), normalizes addresses, and upserts into ErcotEsiidIndex.
`);
}

function sha256File(p: string): string {
  const h = crypto.createHash('sha256');
  const data = readFileSync(p);
  h.update(data);
  return h.digest('hex');
}

function mapHeaders(headers: string[]): Record<string, number> {
  const idx: Record<string, number> = {};
  const upper = headers.map((h) => h.trim().toUpperCase());
  for (const [canon, aliases] of Object.entries(COLUMN_ALIASES)) {
    for (const alias of aliases) {
      const j = upper.indexOf(alias.trim().toUpperCase());
      if (j >= 0) { idx[canon] = j; break; }
    }
  }
  return idx;
}

function pick(row: string[], map: Record<string, number>, key: keyof Canon): string | undefined {
  const j = map[key as string];
  if (j === undefined) return undefined;
  return sanitize(row[j] ?? '');
}

async function upsertBatch(prisma: PrismaClient, items: any[]): Promise<number> {
  if (!items.length) return 0;
  const cols = [
    '"esiid"', '"tdspCode"', '"serviceAddress1"', '"serviceCity"', '"serviceState"', '"serviceZip"',
    '"status"', '"premiseType"', '"postedAtUtc"', '"normLine1"', '"normCity"', '"normZip"',
  ];
  const values: string[] = [];
  const params: any[] = [];
  let p = 1;
  for (const it of items) {
    values.push(`(${cols.map(() => `$${p++}`).join(',')})`);
    params.push(
      it.esiid, it.tdspCode, it.serviceAddress1, it.serviceCity, it.serviceState, it.serviceZip,
      it.status, it.premiseType, it.postedAtUtc, it.normLine1, it.normCity, it.normZip,
    );
  }
  const sql = `
    INSERT INTO "ErcotEsiidIndex" (${cols.join(',')})
    VALUES ${values.join(',')}
    ON CONFLICT ("esiid")
    DO UPDATE SET
      "tdspCode"        = EXCLUDED."tdspCode",
      "serviceAddress1" = EXCLUDED."serviceAddress1",
      "serviceCity"     = EXCLUDED."serviceCity",
      "serviceState"    = EXCLUDED."serviceState",
      "serviceZip"      = EXCLUDED."serviceZip",
      "status"          = EXCLUDED."status",
      "premiseType"     = EXCLUDED."premiseType",
      "postedAtUtc"     = EXCLUDED."postedAtUtc",
      "normLine1"       = EXCLUDED."normLine1",
      "normCity"        = EXCLUDED."normCity",
      "normZip"         = EXCLUDED."normZip"
  `;
  const res = await prisma.$executeRawUnsafe(sql, ...params);
  // NOTE: $executeRawUnsafe returns a driver-dependent value; treat it as successful if no error.
  return Array.isArray(res) ? items.length : (Number(res) || items.length);
}

export async function ingestLocalFile(filePath: string, notes?: string) {
  if (!filePath) {
    throw new Error('ingestLocalFile: filePath is required');
  }
  if (!existsSync(filePath)) {
    throw new Error(`ingestLocalFile: file not found: ${filePath}`);
  }

  const prisma = new PrismaClient();
  const { delimiter, headers } = await sniffFormat(filePath);
  const headerSnapshot = headers.join('|');
  const headerIndex = mapHeaders(headers);

  for (const col of REQUIRED_COLS) {
    if (headerIndex[col] === undefined) {
      throw new Error(`Required column ${col} not found (aliases: ${COLUMN_ALIASES[col].join(', ')})`);
    }
  }

  const fileHash = sha256File(filePath);
  const base = path.basename(filePath);
  const started = new Date();
  let rowsSeen = 0;
  let rowsUpsert = 0;
  const batch: any[] = [];

  for await (const r of iterRows(filePath, delimiter, headers)) {
    rowsSeen++;
    const cells = headers.map((h) => r[h] ?? '');
    const rec: Canon = {
      ESIID: pick(cells, headerIndex, 'ESIID')!,
      TDSP_CODE: pick(cells, headerIndex, 'TDSP_CODE'),
      SERVICE_ADDRESS1: pick(cells, headerIndex, 'SERVICE_ADDRESS1'),
      SERVICE_CITY: pick(cells, headerIndex, 'SERVICE_CITY'),
      SERVICE_STATE: pick(cells, headerIndex, 'SERVICE_STATE'),
      SERVICE_ZIP: pick(cells, headerIndex, 'SERVICE_ZIP'),
      STATUS: pick(cells, headerIndex, 'STATUS'),
      PREMISE_TYPE: pick(cells, headerIndex, 'PREMISE_TYPE'),
      POSTED_DATE: pick(cells, headerIndex, 'POSTED_DATE'),
    };
    if (!rec.ESIID) continue;

    const norm = normalizeAddress({
      line1: rec.SERVICE_ADDRESS1 || null,
      city: rec.SERVICE_CITY || null,
      zip: rec.SERVICE_ZIP || null,
    });

    batch.push({
      esiid: rec.ESIID,
      tdspCode: rec.TDSP_CODE || null,
      serviceAddress1: rec.SERVICE_ADDRESS1 || null,
      serviceCity: rec.SERVICE_CITY || null,
      serviceState: rec.SERVICE_STATE || null,
      serviceZip: rec.SERVICE_ZIP || null,
      status: rec.STATUS || null,
      premiseType: rec.PREMISE_TYPE || null,
      postedAtUtc: rec.POSTED_DATE ? new Date(rec.POSTED_DATE) : new Date(),
      normLine1: norm.normLine1,
      normCity: norm.normCity,
      normZip: norm.normZip,
    });

    if (batch.length >= BATCH_SIZE) {
      rowsUpsert += await upsertBatch(prisma, batch.splice(0));
      process.stdout.write(`\rUpserted: ${rowsUpsert} / Seen: ${rowsSeen}`);
    }
  }

  if (batch.length) {
    rowsUpsert += await upsertBatch(prisma, batch.splice(0));
  }

  const finished = new Date();
  if ((prisma as any).ercotIngestLog?.create) {
    try {
      await (prisma as any).ercotIngestLog.create({
        data: {
          source: `local-file:${filePath}`,
          fileName: base,
          fileHash,
          headerSnapshot,
          rowsSeen,
          rowsUpsert,
          startedAt: started,
          finishedAt: finished,
          notes,
        },
      });
    } catch {
      // ignore logging failures (e.g., table missing)
    }
  }

  console.log(`\nDone. Seen=${rowsSeen}, Upserted=${rowsUpsert}`);
  await prisma.$disconnect();
  return { rowsSeen, rowsUpsert, headerSnapshot };
}

function getArg(flag: string): string | null {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] ?? null : null;
}

async function main() {
  const filePath = getArg('--file');
  const notes = getArg('--notes') || undefined;
  if (!filePath) {
    usage();
    process.exit(2);
  }
  try {
    await ingestLocalFile(filePath, notes);
    process.exit(0);
  } catch (e: any) {
    console.error('ERROR', e?.message || e);
    process.exit(1);
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().catch((e) => {
    console.error('ERROR', e?.message || e);
    process.exit(1);
  });
}
