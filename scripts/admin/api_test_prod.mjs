#!/usr/bin/env node

// scripts/admin/api_test_prod.mjs
// Production API smoke test
// Usage: node scripts/admin/api_test_prod.mjs --base https://intelliwatt.com
//        or: npm run test:prod -- https://intelliwatt.com
//
// Loads .env.vercel (from `vercel env pull .env.vercel --environment=production`)
// and tests public + admin endpoints.

import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';

// Load .env.vercel if it exists
const envPath = resolve(process.cwd(), '.env.vercel');
if (existsSync(envPath)) {
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
}

// Parse CLI args
const baseArgIndex = process.argv.indexOf('--base');
const root = baseArgIndex >= 0 && process.argv[baseArgIndex + 1]
  ? process.argv[baseArgIndex + 1]
  : process.argv[2] || 'https://intelliwatt.com';

const ADMIN_TOKEN = process.env.ADMIN_TOKEN || '';
const CRON_SECRET = process.env.CRON_SECRET || '';

if (!ADMIN_TOKEN) {
  console.error('Missing ADMIN_TOKEN. Load from .env.vercel or set env var.');
  process.exit(1);
}

// Helper functions
async function jget(url, headers = {}) {
  const res = await fetch(url, { headers });
  const text = await res.text();
  try {
    return { status: res.status, ok: res.ok, data: JSON.parse(text) };
  } catch {
    return { status: res.status, ok: res.ok, text };
  }
}

async function jpost(url, headers = {}, body = {}) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  try {
    return { status: res.status, ok: res.ok, data: JSON.parse(text) };
  } catch {
    return { status: res.status, ok: res.ok, text };
  }
}

function print(label, result) {
  console.log(`\n[${label}]`);
  console.log(`Status: ${result.status} ${result.ok ? 'OK' : 'ERROR'}`);
  if (result.data) {
    console.log(JSON.stringify(result.data, null, 2));
  } else if (result.text) {
    console.log(result.text);
  }
}

// Run tests
(async () => {
  console.log(`Testing: ${root}`);
  console.log(`Admin Token: ${ADMIN_TOKEN ? '✅ Set' : '❌ Missing'}`);
  console.log(`Cron Secret: ${CRON_SECRET ? '✅ Set' : '❌ Missing'}`);

  print('PING', await jget(`${root}/api/ping`));
  print('ENV HEALTH', await jget(`${root}/api/admin/env-health`, { 'x-admin-token': ADMIN_TOKEN }));

  if (CRON_SECRET) {
    print('CRON ECHO', await jget(`${root}/api/admin/ercot/debug/echo-cron`, { 'x-cron-secret': CRON_SECRET }));
    print('ERCOT CRON', await jget(`${root}/api/admin/ercot/cron`, { 'x-cron-secret': CRON_SECRET }));
  }

  // --- WATTBUY (current flow, no 'offers') ---

  const addr = '9514 Santa Paula Dr';
  const city = 'Fort Worth';
  const state = 'tx';
  const zip = '76116';

  const q = (v) => encodeURIComponent(v);
  print('WATTBUY ELECTRICITY (robust)',
    await jget(`${root}/api/admin/wattbuy/electricity-probe?address=${q(addr)}&city=${q(city)}&state=${state}&zip=${zip}`, {
      'x-admin-token': ADMIN_TOKEN,
    })
  );
  print('WATTBUY ELECTRICITY SAVE',
    await jget(`${root}/api/admin/wattbuy/electricity-save?address=${q(addr)}&city=${q(city)}&state=${state}&zip=${zip}`, {
      'x-admin-token': ADMIN_TOKEN,
    })
  );
  print('WATTBUY RETAIL RATES (explicit Oncor 44372)',
    await jget(`${root}/api/admin/wattbuy/retail-rates-test?utilityID=44372&state=tx`, {
      'x-admin-token': ADMIN_TOKEN,
    })
  );
  print('WATTBUY RETAIL RATES (by address)',
    await jget(`${root}/api/admin/wattbuy/retail-rates-by-address?address=${q(addr)}&city=${q(city)}&state=${state}&zip=${zip}`, {
      'x-admin-token': ADMIN_TOKEN,
    })
  );
  print('WATTBUY RETAIL RATES (zip auto-derive 75201)',
    await jget(`${root}/api/admin/wattbuy/retail-rates-zip?zip=75201`, {
      'x-admin-token': ADMIN_TOKEN,
    })
  );
  console.log('\nDONE.');
})();

