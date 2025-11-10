#!/usr/bin/env node

import 'node:process';
import { setTimeout as delay } from 'node:timers/promises';

function parseArgs() {
  const args = process.argv.slice(2);
  const out = {};
  for (let i = 0; i < args.length; i += 2) {
    const key = args[i];
    const val = args[i + 1];
    if (!key) continue;
    if (key === '--base') out.base = val;
  }
  return out;
}

function need(name) {
  const v = process.env[name];
  if (!v || v.length === 0) throw new Error(`Missing required env: ${name}. Pull Vercel envs or export it.`);
  return v;
}

async function jget(url, headers = {}) {
  const res = await fetch(url, { headers });
  const txt = await res.text();
  let body;
  try { body = JSON.parse(txt); } catch { body = txt; }
  return { status: res.status, body };
}

function print(label, { status, body }) {
  const safe = v => typeof v === 'string' ? v : JSON.stringify(v, null, 2);
  console.log(`\n=== ${label} [${status}] ===\n${safe(body)}`);
}

async function main() {
  // Try to load .env.vercel first, then fallback to dotenv/config
  try {
    const { readFileSync, existsSync } = await import('fs');
    const envPath = '.env.vercel';
    if (existsSync(envPath)) {
      const content = readFileSync(envPath, 'utf8');
      for (const line of content.split(/\r?\n/)) {
        const trimmed = line.trim();
        if (trimmed && !trimmed.startsWith('#')) {
          const equalIndex = trimmed.indexOf('=');
          if (equalIndex > 0) {
            const key = trimmed.substring(0, equalIndex).trim();
            const value = trimmed.substring(equalIndex + 1).trim().replace(/^["']|["']$/g, '');
            if (key) process.env[key] = value;
          }
        }
      }
    }
  } catch {}
  try { await import('dotenv/config'); } catch {}

  const { base } = parseArgs();
  if (!base || !/^https?:\/\//i.test(base)) throw new Error('Pass a base URL: --base https://intelliwatt.com');

  const root = base.replace(/\/$/, '');

  print('PING', await jget(`${root}/api/ping`));
  print('PING.TXT', await jget(`${root}/api/ping.txt`));

  const ADMIN_TOKEN = need('ADMIN_TOKEN');
  print('ENV HEALTH', await jget(`${root}/api/admin/env-health`, { 'x-admin-token': ADMIN_TOKEN }));

  const CRON_SECRET = need('CRON_SECRET');
  print('ERCOT CRON (token via header)', await jget(`${root}/api/admin/ercot/cron`, { 'x-cron-secret': CRON_SECRET }));
  await delay(150);

  // --- WattBuy (no changes to your working code) ---
  const q = encodeURIComponent;
  const addr = '9514 Santa Paula Dr', city = 'Fort Worth', state = 'tx', zip = '76116';

  print('WATTBUY ELECTRICITY (probe)',
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
  print('WATTBUY RETAIL RATES (zip 75201)',
    await jget(`${root}/api/admin/wattbuy/retail-rates-zip?zip=75201`, {
      'x-admin-token': ADMIN_TOKEN,
    })
  );

  console.log('\nDONE.');
}

main().catch((err) => {
  console.error('\nTEST FAILED:', err?.message || err);
  process.exitCode = 1;
});
