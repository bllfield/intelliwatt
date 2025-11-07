import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { Pool } = require('pg');
import dotenv from 'dotenv';
import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';

if (process.env.NODE_TLS_REJECT_UNAUTHORIZED === undefined) {
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
}

// Prefer .env.local, then .env (don’t override existing env)
dotenv.config({ path: '.env.local', override: false });
dotenv.config({ path: '.env', override: false });

function loadEnvFallback(filePath) {
  if (!existsSync(filePath)) return;
  try {
    const buf = readFileSync(filePath);
    let raw;
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
      if (!key || key in process.env) continue;
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith('\'') && value.endsWith('\''))) {
        value = value.slice(1, -1);
      }
      process.env[key] = value;
    }
  } catch (err) {
    console.warn(`Warning: failed to load env fallback ${filePath}:`, err?.message || err);
  }
}

loadEnvFallback(resolve(process.cwd(), '.env.local'));
loadEnvFallback(resolve(process.cwd(), '.env'));

function out(title, value) {
  const banner = `\n=== ${title} ===`;
  console.log(banner);
  console.log(value ?? '(null)');
}

function buildSslOption(url) {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname?.toLowerCase() || '';
    if (!host || host === 'localhost' || host === '127.0.0.1') {
      return false;
    }
    if (parsed.searchParams.get('sslmode') === 'disable') {
      return false;
    }
  } catch {
    // if URL parsing fails, fall through to enabling SSL
  }
  return { rejectUnauthorized: false };
}

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('ERROR: DATABASE_URL is not set in the environment.');
    process.exit(2);
  }

  const pool = new Pool({
    connectionString: url,
    max: 1,
    ssl: buildSslOption(url),
  });

  try {
    const client = await pool.connect();

    // 1) Table exists?
    const q1 = `SELECT to_regclass('public."ErcotEsiidIndex"') AS table_name;`;
    const r1 = await client.query(q1);
    const tableName = r1.rows?.[0]?.table_name || null;
    out('Table Exists?', tableName);

    // 2) pg_trgm enabled?
    const q2 = `SELECT extname FROM pg_extension WHERE extname = 'pg_trgm';`;
    const r2 = await client.query(q2);
    const trgm = r2.rows?.[0]?.extname || null;
    out('pg_trgm Enabled?', trgm);

    // 3) Index present?
    const q3 = `
      SELECT indexname, indexdef
      FROM pg_indexes
      WHERE tablename = 'ErcotEsiidIndex'
      ORDER BY indexname;
    `;
    const r3 = await client.query(q3);
    out('Indexes on ErcotEsiidIndex', r3.rows);

    // Evaluate pass/fail
    const hasTable = !!tableName;
    const hasTrgm = trgm === 'pg_trgm';
    const hasTrgmIndex = r3.rows.some(
      (row) =>
        row.indexname === 'ercot_esiid_index_normline1_trgm' &&
        /USING gin/i.test(row.indexdef) &&
        /gin_trgm_ops/i.test(row.indexdef)
    );

    console.log('\n=== Summary ===');
    console.log(`Table: ${hasTable ? 'OK' : 'MISSING'}`);
    console.log(`pg_trgm: ${hasTrgm ? 'OK' : 'MISSING'}`);
    console.log(`Trigram Index: ${hasTrgmIndex ? 'OK' : 'MISSING'}`);

    // Exit code rules: 0 = all good, 1 = partial/missing
    process.exit(hasTable && hasTrgm && hasTrgmIndex ? 0 : 1);
  } catch (err) {
    console.error('ERROR:', err?.message || err);
    process.exit(3);
  } finally {
    await new Promise((r) => setTimeout(r, 0));
  }
}

main().catch((e) => {
  console.error('FATAL:', e?.message || e);
  process.exit(4);
});

