// scripts/admin/smoke.ts
// Usage examples (in Cursor terminal):
//  ADMIN_TOKEN=xxx npm run admin:summary
//  ADMIN_TOKEN=xxx CRON_SECRET=yyy npm run admin:catch
//
// If you prefer .env.local, create one locally (not committed) and run via `npm run admin:summary`.
//
// Base URL: defaults to production. Override with BASE_URL if needed.

import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';

// Load .env.local if it exists
const envPath = resolve(process.cwd(), '.env.local');
if (existsSync(envPath)) {
  try {
    const envContent = readFileSync(envPath, 'utf-8');
    for (const line of envContent.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (trimmed && !trimmed.startsWith('#')) {
        const equalIndex = trimmed.indexOf('=');
        if (equalIndex > 0) {
          const key = trimmed.substring(0, equalIndex).trim();
          const value = trimmed.substring(equalIndex + 1).trim();
          // Remove quotes if present
          const cleanValue = value.replace(/^["']|["']$/g, '');
          if (key) {
            process.env[key] = cleanValue;
          }
        }
      }
    }
  } catch (e) {
    // .env.local exists but can't be read, that's fine
  }
}

const BASE_URL = process.env.BASE_URL || 'https://intelliwatt.com';
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || '';
const CRON_SECRET = process.env.CRON_SECRET || '';

if (!ADMIN_TOKEN) {
  console.error('Missing ADMIN_TOKEN. Provide it via env (ADMIN_TOKEN=...) or .env.local');
  process.exit(1);
}

const mode = process.argv[2] || 'summary'; // 'summary' | 'catch'
const esiid = process.env.ESIID;           // optional filter
const meter = process.env.METER;           // optional filter
const dateStart = process.env.DATE_START;  // optional ISO
const dateEnd = process.env.DATE_END;      // optional ISO

async function adminFetch(path: string, init: RequestInit = {}) {
  const headers: Record<string, string> = {
    'x-admin-token': ADMIN_TOKEN,
    ...(init.headers as Record<string, string> || {}),
  };
  const res = await fetch(`${BASE_URL}${path}`, { ...init, headers });
  const text = await res.text();
  let json: any;
  try { json = JSON.parse(text); } catch { json = { raw: text }; }
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} on ${path}: ${text}`);
  }
  return json;
}

async function cronFetch(path: string, init: RequestInit = {}) {
  const headers: Record<string, string> = {
    'x-vercel-cron': '1',
    ...(CRON_SECRET ? { 'x-cron-secret': CRON_SECRET } : {}),
    ...(init.headers as Record<string, string> || {}),
  };
  const res = await fetch(`${BASE_URL}${path}`, { ...init, headers });
  const text = await res.text();
  let json: any;
  try { json = JSON.parse(text); } catch { json = { raw: text }; }
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} on ${path}: ${text}`);
  }
  return json;
}

async function runSummary() {
  const params = new URLSearchParams();
  if (esiid) params.set('esiid', esiid);
  if (meter) params.set('meter', meter);
  if (dateStart) params.set('dateStart', dateStart);
  if (dateEnd) params.set('dateEnd', dateEnd);

  const path = `/api/admin/analysis/daily-summary${params.toString() ? `?${params}` : ''}`;
  const t0 = Date.now();
  const json = await adminFetch(path, { method: 'GET' });
  const ms = Date.now() - t0;

  // Simple console report
  const rows = json?.rows || [];
  console.log(`\n=== DAILY SUMMARY (${rows.length} rows, ${ms} ms) ===`);
  const sample = rows.slice(0, 10); // show first 10
  for (const r of sample) {
    console.log(`${r.esiid || '∅'} | ${r.meter || '∅'} | ${r.date} | slots=${r.totalSlots} | completeness=${(r.completeness*100).toFixed(1)}% | missing=${r.has_missing}`);
  }
  if (rows.length > sample.length) console.log(`... +${rows.length - sample.length} more`);
}

async function runCatch() {
  if (!CRON_SECRET) {
    console.warn('Warning: CRON_SECRET not set — the route will likely reject. Provide CRON_SECRET to simulate Vercel Cron auth.');
  }
  const t0 = Date.now();
  const json = await cronFetch('/api/admin/cron/normalize-smt-catch', { method: 'POST' });
  const ms = Date.now() - t0;
  console.log(`\n=== CATCH SWEEP RESULT (${ms} ms) ===\n`, JSON.stringify(json, null, 2));
}

(async () => {
  try {
    if (mode === 'catch') {
      await runCatch();
    } else {
      await runSummary();
    }
  } catch (e: any) {
    console.error('Smoke test failed:', e?.message || e);
    process.exit(1);
  }
})();
