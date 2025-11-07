#!/usr/bin/env node
// Production API smoke test for IntelliWatt.
// Usage:
//   node scripts/admin/api_test_prod.mjs --base https://intelliwatt.com
//   npm run test:prod -- https://intelliwatt.com

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
  const value = process.env[name];
  if (!value || value.length === 0) {
    throw new Error(`Missing required env: ${name}. Pull Vercel envs or export it before running.`);
  }
  return value;
}

async function jget(url, headers = {}) {
  const res = await fetch(url, { headers });
  const text = await res.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    body = text;
  }
  return { status: res.status, body };
}

async function jpost(url, headers = {}, data = {}) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(data),
  });
  const text = await res.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    body = text;
  }
  return { status: res.status, body };
}

function print(label, { status, body }) {
  const safe = (value) => (typeof value === 'string' ? value : JSON.stringify(value, null, 2));
  console.log(`\n=== ${label} [${status}] ===\n${safe(body)}`);
}

async function main() {
  try {
    await import('dotenv/config');
  } catch {
    // noop if dotenv is not installed or .env.vercel missing
  }

  const { base } = parseArgs();
  if (!base || !/^https?:\/\//i.test(base)) {
    throw new Error('Pass a base URL: --base https://intelliwatt.com');
  }
  const root = base.replace(/\/$/, '');

  print('PING', await jget(`${root}/api/ping`));

  const ADMIN_TOKEN = need('ADMIN_TOKEN');
  print('ENV HEALTH', await jget(`${root}/api/admin/env-health`, { 'x-admin-token': ADMIN_TOKEN }));

  const CRON_SECRET = need('CRON_SECRET');
  print('CRON ECHO', await jget(`${root}/api/admin/ercot/debug/echo-cron`, { 'x-cron-secret': CRON_SECRET }));
  await delay(200);
  print('CRON RUN (manual)', await jget(`${root}/api/admin/ercot/cron`, { 'x-cron-secret': CRON_SECRET }));

  print('WATTBUY PROBE', await jpost(`${root}/api/admin/wattbuy/probe-offers`, { 'x-admin-token': ADMIN_TOKEN }, { zip5: '76107', state: 'TX' }));
  print('PUBLIC OFFERS', await jget(`${root}/api/offers?zip5=76107`));
  print('OFFERS RECENT', await jget(`${root}/api/admin/offers/recent?limit=25`, { 'x-admin-token': ADMIN_TOKEN }));

  console.log('\nDONE.');
}

main().catch((err) => {
  console.error('\nTEST FAILED:', err?.message || err);
  process.exitCode = 1;
});
