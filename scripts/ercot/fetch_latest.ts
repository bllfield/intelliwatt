import dotenv from 'dotenv';
dotenv.config({ path: '.env.local', override: false });
dotenv.config({ path: '.env', override: false });

import fs from 'fs';
import os from 'os';
import path from 'path';
import crypto from 'crypto';
import { fetchToBuffer } from '../../lib/ercot/http';
import { ingestLocalFile } from './load_from_file';

function usage() {
  console.log(`
Usage:
  npm run ercot:fetch:latest -- --url https://<PUBLIC_FILE_URL> [--notes "daily pull"]

Notes:
  - Fetches the file to a temp path, computes a SHA-256, skips ingest if unchanged,
    then calls ingestLocalFile(file).
`);
}

function getArg(flag: string): string | null {
  const idx = process.argv.indexOf(flag);
  return idx >= 0 ? process.argv[idx + 1] ?? null : null;
}

function sha(buf: Buffer) {
  const h = crypto.createHash('sha256');
  h.update(buf);
  return h.digest('hex');
}

async function main() {
  const url = getArg('--url');
  const notes = getArg('--notes') || undefined;
  if (!url) {
    usage();
    process.exit(2);
  }

  console.log('Fetching:', url);
  const buf = await fetchToBuffer({ url });
  const hash = sha(buf);
  const baseName = path.basename(new URL(url).pathname) || `ercot_${Date.now()}.txt`;
  const tempOut = path.join(os.tmpdir(), baseName);
  const hashFile = tempOut + '.sha256';

  if (fs.existsSync(hashFile)) {
    const prev = fs.readFileSync(hashFile, 'utf8').trim();
    if (prev === hash) {
      console.log('No change detected (same SHA-256). Skipping ingest.');
      process.exit(0);
    }
  }

  fs.writeFileSync(tempOut, buf);
  fs.writeFileSync(hashFile, hash);
  console.log('Saved to', tempOut, 'hash', hash);

  const result = await ingestLocalFile(tempOut, notes ?? `remote:${url}`);
  console.log('Ingest result:', result);
}

main().catch((err) => {
  console.error('ERROR', err?.message || err);
  process.exit(1);
});
