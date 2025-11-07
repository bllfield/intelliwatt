import dotenv from 'dotenv';
import { existsSync, readFileSync } from 'fs';
import { resolve } from 'path';

dotenv.config({ path: '.env.local', override: false });
dotenv.config({ path: '.env', override: false });

if (process.env.NODE_TLS_REJECT_UNAUTHORIZED === undefined) {
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
}

function loadEnvFallback(filePath: string) {
  if (!existsSync(filePath)) return;
  try {
    const buf = readFileSync(filePath);
    let raw: string;
    if (buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xfe) {
      raw = buf.toString('utf16le');
    } else if (buf.length >= 2 && buf[0] === 0xfe && buf[1] === 0xff) {
      raw = buf.swap16().toString('utf16le');
    } else {
      raw = buf.toString('utf8');
      if (raw.charCodeAt(0) === 0xfeff) raw = raw.slice(1);
    }
    for (const line of raw.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const idx = trimmed.indexOf('=');
      if (idx <= 0) continue;
      const key = trimmed.slice(0, idx).trim();
      let value = trimmed.slice(idx + 1).trim();
      if (!key || process.env[key] !== undefined) continue;
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith('\'') && value.endsWith('\''))) {
        value = value.slice(1, -1);
      }
      process.env[key] = value;
    }
  } catch (err) {
    console.warn(`Warning: failed to load env fallback ${filePath}:`, (err as any)?.message || err);
  }
}

loadEnvFallback(resolve(process.cwd(), '.env.local'));
loadEnvFallback(resolve(process.cwd(), '.env'));

import { findErcotCandidates } from '../../lib/ercot/match';

function usage() {
  console.log(`
Usage:
  npm run ercot:test -- --line1 "9514 SANTA PAULA DR" --zip 76116 [--city "FORT WORTH"] [--min 0.85] [--limit 5]

Notes:
  - DATABASE_URL is read automatically from .env.local (then .env).
  - You can override at runtime: DATABASE_URL="postgres://..." npm run ercot:test -- --line1 ...
`);
}

type Args = {
  line1: string | null;
  zip: string | null;
  city?: string | null;
  min?: number | null;
  limit?: number | null;
};

function parseArgs(argv: string[]): Args {
  const args: Args = { line1: null, zip: null, city: null, min: null, limit: null };
  for (let i = 2; i < argv.length; i++) {
    const k = argv[i];
    const v = argv[i + 1];
    if (k === '--line1') {
      args.line1 = v;
      i++;
    } else if (k === '--zip') {
      args.zip = v;
      i++;
    } else if (k === '--city') {
      args.city = v;
      i++;
    } else if (k === '--min') {
      args.min = parseFloat(v);
      i++;
    } else if (k === '--limit') {
      args.limit = parseInt(v, 10);
      i++;
    }
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv);
  if (!args.line1 || !args.zip) {
    usage();
    process.exit(2);
  }

  const result = await findErcotCandidates({
    line1: args.line1,
    city: args.city || undefined,
    zip: args.zip,
    minScore: args.min ?? undefined,
    limit: args.limit ?? undefined,
  });

  console.log(JSON.stringify(result, null, 2));
  process.exit(result.ok ? 0 : 1);
}

main().catch((e) => {
  console.error('ERROR', e?.message || e);
  process.exit(3);
});

