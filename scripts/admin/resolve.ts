// scripts/admin/resolve.ts
// Run from Cursor terminal with npm scripts below.
// Examples:
//   npm run address:esiid -- "9515 Santa Paula Dr" "Fort Worth" "TX" "76116"
//   npm run esiid:meter -- 10443720004895510

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
const WATTBUY_API_KEY = process.env.WATTBUY_API_KEY || '';

if (!ADMIN_TOKEN) {
  console.error('Missing ADMIN_TOKEN in env');
  process.exit(1);
}

async function post(path: string, body: any, extraHeaders: Record<string, string> = {}) {
  const res = await fetch(`${BASE_URL}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-admin-token': ADMIN_TOKEN, ...extraHeaders },
    body: JSON.stringify(body),
  });

  const text = await res.text();
  let json: any;
  try {
    json = JSON.parse(text);
  } catch {
    json = { raw: text };
  }

  if (!res.ok) throw new Error(`HTTP ${res.status}: ${text}`);
  return json;
}

(async () => {
  const mode = process.argv[2];

  if (mode === 'address') {
    if (!WATTBUY_API_KEY) {
      console.error('Missing WATTBUY_API_KEY in env');
      process.exit(1);
    }

    const [, , , line1, city, state, zip] = process.argv;

    if (!line1 || !city || !state || !zip) {
      console.error('Provide: "<line1>" "<city>" "<state>" "<zip>"');
      process.exit(1);
    }

    const json = await post('/api/admin/address/resolve-esiid', { line1, city, state, zip });
    console.log('\n=== ADDRESS → ESIID ===\n', JSON.stringify(json, null, 2));
  } else if (mode === 'esiid') {
    const esiid = process.argv[3];

    if (!esiid) {
      console.error('Provide ESIID');
      process.exit(1);
    }

    const json = await post('/api/admin/esiid/resolve-meter', { esiid });
    console.log('\n=== ESIID → METER ===\n', JSON.stringify(json, null, 2));
  } else {
    console.error('Usage: npm run address:esiid -- "<line1>" "<city>" "<state>" "<zip>"  OR  npm run esiid:meter -- <ESIID>');
    process.exit(1);
  }
})();

