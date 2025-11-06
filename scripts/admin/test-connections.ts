// scripts/admin/test-connections.ts
// Comprehensive test of SMT and WattBuy API connections and database writes
// Usage: npm run test:connections

import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';
// @ts-ignore - tsx may not resolve @/ paths, using relative
import { prisma } from '../../lib/db';

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
const SHARED_INGEST_SECRET = process.env.SHARED_INGEST_SECRET || '';
const WATTBUY_API_KEY = process.env.WATTBUY_API_KEY || '';

interface TestResult {
  name: string;
  passed: boolean;
  error?: string;
  details?: any;
}

const results: TestResult[] = [];

async function test(name: string, fn: () => Promise<any>): Promise<void> {
  try {
    console.log(`\n🧪 Testing: ${name}...`);
    const details = await fn();
    results.push({ name, passed: true, details });
    console.log(`✅ PASSED: ${name}`);
    if (details) {
      console.log(`   Details:`, JSON.stringify(details, null, 2).slice(0, 200));
    }
  } catch (e: any) {
    results.push({ name, passed: false, error: e?.message || String(e) });
    console.log(`❌ FAILED: ${name}`);
    console.log(`   Error: ${e?.message || e}`);
  }
}

async function adminFetch(path: string, init: RequestInit = {}) {
  const headers: Record<string, string> = {
    'x-admin-token': ADMIN_TOKEN,
    'content-type': 'application/json',
    ...(init.headers as Record<string, string> || {}),
  };
  const res = await fetch(`${BASE_URL}${path}`, { ...init, headers });
  const text = await res.text();
  let json: any;
  try {
    json = JSON.parse(text);
  } catch {
    json = { raw: text };
  }
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}: ${JSON.stringify(json)}`);
  }
  return json;
}

async function sharedSecretFetch(path: string, body: any) {
  const res = await fetch(`${BASE_URL}${path}`, {
    method: 'POST',
    headers: {
      'x-shared-secret': SHARED_INGEST_SECRET,
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let json: any;
  try {
    json = JSON.parse(text);
  } catch {
    json = { raw: text };
  }
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}: ${JSON.stringify(json)}`);
  }
  return json;
}

// ==================== SMT TESTS ====================

async function testSmtIngestNormalize() {
  const testEsiid = '10443720004895510';
  const testMeter = '123652874LG';
  const now = new Date();
  const testRows = [
    {
      timestamp: new Date(now.getTime() - 15 * 60 * 1000).toISOString(),
      kwh: 0.25,
    },
    {
      timestamp: now.toISOString(),
      kwh: 0.30,
    },
  ];

  const result = await sharedSecretFetch('/api/internal/smt/ingest-normalize', {
    esiid: testEsiid,
    meter: testMeter,
    rows: testRows,
    saveFilled: true,
  });

  if (!result.ok) throw new Error('SMT ingest-normalize returned ok=false');
  if (result.persisted === undefined) throw new Error('Missing persisted count');

  // Verify data in database
  const intervals = await prisma.smtInterval.findMany({
    where: {
      esiid: testEsiid,
      meter: testMeter,
    },
    orderBy: { ts: 'desc' },
    take: 5,
  });

  return {
    persisted: result.persisted,
    normalizedPoints: result.normalizedPoints,
    dbIntervalsFound: intervals.length,
    sampleInterval: intervals[0] ? {
      esiid: intervals[0].esiid,
      meter: intervals[0].meter,
      ts: intervals[0].ts,
      kwh: intervals[0].kwh.toString(),
      filled: intervals[0].filled,
    } : null,
  };
}

async function testSmtDailySummary() {
  const result = await adminFetch('/api/admin/analysis/daily-summary', {
    method: 'GET',
  });

  if (!result.ok) throw new Error('Daily summary returned ok=false');
  if (!Array.isArray(result.rows)) throw new Error('Missing rows array');

  return {
    rowCount: result.rows.length,
    sampleRow: result.rows[0] || null,
  };
}

async function testSmtDatabaseCounts() {
  const totalIntervals = await prisma.smtInterval.count();
  const realIntervals = await prisma.smtInterval.count({
    where: { filled: false },
  });
  const filledIntervals = await prisma.smtInterval.count({
    where: { filled: true },
  });

  const uniqueEsiids = await prisma.$queryRawUnsafe<{ count: bigint }[]>(
    'SELECT COUNT(DISTINCT esiid) as count FROM "SmtInterval"'
  );
  const uniqueMeters = await prisma.$queryRawUnsafe<{ count: bigint }[]>(
    'SELECT COUNT(DISTINCT meter) as count FROM "SmtInterval"'
  );

  return {
    totalIntervals: Number(totalIntervals),
    realIntervals: Number(realIntervals),
    filledIntervals: Number(filledIntervals),
    uniqueEsiids: Number(uniqueEsiids[0]?.count || 0),
    uniqueMeters: Number(uniqueMeters[0]?.count || 0),
  };
}

// ==================== WATTBUY TESTS ====================

async function testWattBuyAddressResolve() {
  if (!WATTBUY_API_KEY) {
    throw new Error('WATTBUY_API_KEY not set - skipping WattBuy test');
  }

  const result = await adminFetch('/api/admin/address/resolve-esiid', {
    method: 'POST',
    body: JSON.stringify({
      line1: '9515 Santa Paula Dr',
      city: 'Fort Worth',
      state: 'TX',
      zip: '76116',
    }),
  });

  if (!result.ok) throw new Error('Address resolve returned ok=false');

  return {
    esiid: result.esiid,
    utility: result.utility,
    territory: result.territory,
  };
}

async function testWattBuyEsiidToMeter() {
  const testEsiid = '10443720004895510';
  const result = await adminFetch('/api/admin/esiid/resolve-meter', {
    method: 'POST',
    body: JSON.stringify({ esiid: testEsiid }),
  });

  if (!result.ok) throw new Error('ESIID resolve returned ok=false');

  return {
    esiid: result.esiid,
    meterId: result.meterId,
    meterIds: result.meterIds,
  };
}

async function testWattBuyOffersSync() {
  if (!WATTBUY_API_KEY) {
    throw new Error('WATTBUY_API_KEY not set - skipping WattBuy test');
  }

  const result = await adminFetch('/api/wattbuy/offers/sync', {
    method: 'POST',
    body: JSON.stringify({
      address: '9515 Santa Paula Dr',
      city: 'Fort Worth',
      state: 'TX',
      zip: '76116',
    }),
  });

  if (result.error) throw new Error(result.error);

  // Verify data in database
  const offerMaps = await prisma.offerRateMap.findMany({
    take: 5,
    orderBy: { lastSeenAt: 'desc' },
  });

  const rateConfigs = await prisma.rateConfig.findMany({
    take: 5,
    orderBy: { createdAt: 'desc' },
  });

  return {
    totalOffers: result.totalOffers,
    inserted: result.inserted,
    updated: result.updated,
    createdRateConfigs: result.createdRateConfigs,
    dbOfferMaps: offerMaps.length,
    dbRateConfigs: rateConfigs.length,
  };
}

async function testWattBuyDatabaseCounts() {
  const offerMaps = await prisma.offerRateMap.count();
  const rateConfigs = await prisma.rateConfig.count();
  const masterPlans = await prisma.masterPlan.count();

  return {
    offerMaps: Number(offerMaps),
    rateConfigs: Number(rateConfigs),
    masterPlans: Number(masterPlans),
  };
}

// ==================== MAIN ====================

async function runAllTests() {
  console.log('\n🔍 Starting Connection & Database Tests...\n');
  console.log(`Base URL: ${BASE_URL}`);
  console.log(`Admin Token: ${ADMIN_TOKEN ? '✅ Set' : '❌ Missing'}`);
  console.log(`Shared Secret: ${SHARED_INGEST_SECRET ? '✅ Set' : '❌ Missing'}`);
  console.log(`WattBuy API Key: ${WATTBUY_API_KEY ? '✅ Set' : '❌ Missing'}`);

  // SMT Tests
  await test('SMT: Ingest & Normalize', testSmtIngestNormalize);
  await test('SMT: Daily Summary', testSmtDailySummary);
  await test('SMT: Database Counts', testSmtDatabaseCounts);

  // WattBuy Tests
  await test('WattBuy: Address → ESIID', testWattBuyAddressResolve);
  await test('WattBuy: ESIID → Meter', testWattBuyEsiidToMeter);
  await test('WattBuy: Offers Sync', testWattBuyOffersSync);
  await test('WattBuy: Database Counts', testWattBuyDatabaseCounts);

  // Summary
  console.log('\n\n📊 TEST SUMMARY\n');
  console.log('='.repeat(60));
  const passed = results.filter((r) => r.passed).length;
  const failed = results.filter((r) => !r.passed).length;

  for (const r of results) {
    const icon = r.passed ? '✅' : '❌';
    console.log(`${icon} ${r.name}`);
    if (!r.passed && r.error) {
      console.log(`   Error: ${r.error}`);
    }
  }

  console.log('='.repeat(60));
  console.log(`\nTotal: ${results.length} | Passed: ${passed} | Failed: ${failed}\n`);

  if (failed > 0) {
    process.exit(1);
  }
}

runAllTests()
  .catch((e) => {
    console.error('Fatal error:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

