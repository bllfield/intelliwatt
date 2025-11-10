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
    // Read file as buffer first to detect encoding
    const buffer = readFileSync(envPath);
    let envContent: string;
    
    // Check for UTF-16 BOM (FE FF for BE, FF FE for LE)
    if (buffer.length >= 2 && buffer[0] === 0xFF && buffer[1] === 0xFE) {
      // UTF-16 LE
      envContent = buffer.toString('utf16le');
      console.log(`[DEBUG] Detected UTF-16 LE encoding`);
    } else if (buffer.length >= 2 && buffer[0] === 0xFE && buffer[1] === 0xFF) {
      // UTF-16 BE (less common)
      envContent = buffer.swap16().toString('utf16le');
      console.log(`[DEBUG] Detected UTF-16 BE encoding`);
    } else {
      // Try UTF-8, remove BOM if present
      envContent = buffer.toString('utf-8');
      if (envContent.charCodeAt(0) === 0xFEFF) {
        envContent = envContent.slice(1);
        console.log(`[DEBUG] Removed UTF-8 BOM`);
      }
    }
    
    console.log(`[DEBUG] File read: ${envContent.length} chars, ${envContent.split(/\r?\n/).length} lines`);
    let loadedCount = 0;
    const importantKeys = ['SHARED_INGEST_SECRET', 'WATTBUY_API_KEY', 'DATABASE_URL', 'ADMIN_TOKEN'];
    const foundKeys: string[] = [];
    
    const parsedKeysList: string[] = [];
    for (const line of envContent.split(/\r?\n/)) {
      const trimmed = line.trim();
      // Skip empty lines and comments
      if (!trimmed || trimmed.startsWith('#')) continue;
      
      const equalIndex = trimmed.indexOf('=');
      if (equalIndex <= 0) continue; // No = found or = at start
      
      const key = trimmed.substring(0, equalIndex).trim();
      parsedKeysList.push(key);
      let value = trimmed.substring(equalIndex + 1);
      
      // Handle quoted values (can span multiple lines or have escaped quotes)
      if ((value.startsWith('"') && value.endsWith('"')) || 
          (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      
      // Trim after removing quotes
      value = value.trim();
      
      // Handle escaped characters in quoted strings
      if (value.includes('\\')) {
        value = value.replace(/\\n/g, '\n').replace(/\\t/g, '\t').replace(/\\"/g, '"').replace(/\\'/g, "'");
      }
      
      if (key) {
        const isImportant = importantKeys.includes(key);
        if (isImportant) {
          foundKeys.push(key);
          console.log(`[DEBUG] Found important key: "${key}" with value length ${value.length}`);
        }
        
        process.env[key] = value;
        loadedCount++;
        
        // Verify it was set immediately
        if (isImportant) {
          const setValue = process.env[key];
          if (!setValue) {
            console.log(`[DEBUG]   ⚠️  ERROR: Key "${key}" was NOT set in process.env!`);
          } else if (setValue.length !== value.length) {
            console.log(`[DEBUG]   ⚠️  WARNING: Length mismatch for "${key}": expected ${value.length}, got ${setValue.length}`);
          } else {
            console.log(`[DEBUG]   ✅ Key "${key}" set correctly (${setValue.length} chars)`);
          }
        }
      }
    }
    if (loadedCount > 0) {
      console.log(`[DEBUG] Loaded ${loadedCount} environment variables from .env.local`);
      console.log(`[DEBUG] Important keys found during parsing: ${foundKeys.length}/${importantKeys.length} (${foundKeys.join(', ')})`);
      
      // Show keys that were parsed from the file
      console.log(`[DEBUG] Keys parsed from file (first 15): ${parsedKeysList.slice(0, 15).join(', ')}`);
      console.log(`[DEBUG] Looking for these important keys: ${importantKeys.join(', ')}`);
      
      // Show all keys that were parsed (first 10)
      const allParsedKeys = Object.keys(process.env).filter(k => !k.startsWith('npm_') && !k.startsWith('NODE_') && !k.startsWith('PATH') && !k.startsWith('TEMP') && !k.startsWith('ALL') && !k.startsWith('APP') && !k.startsWith('CHROME') && !k.startsWith('COLOR') && !k.startsWith('Common') && !k.startsWith('COMPUTER') && !k.startsWith('ComSpec'));
      console.log(`[DEBUG] Custom env vars in process.env (first 10): ${allParsedKeys.slice(0, 10).join(', ')}`);
      
      // Check if keys exist with different casing or whitespace
      for (const importantKey of importantKeys) {
        const exact = process.env[importantKey];
        const upper = process.env[importantKey.toUpperCase()];
        const lower = process.env[importantKey.toLowerCase()];
        console.log(`[DEBUG] Checking "${importantKey}": exact=${!!exact}, upper=${!!upper}, lower=${!!lower}`);
        if (!exact) {
          // Try to find similar keys
          const similar = allParsedKeys.filter(k => k.toUpperCase().includes(importantKey.toUpperCase()));
          if (similar.length > 0) {
            console.log(`[DEBUG]   Found similar: ${similar.join(', ')}`);
          }
        }
      }
      
      // Final verification
      console.log(`[DEBUG] Final verification of process.env:`);
      for (const key of importantKeys) {
        const val = process.env[key];
        console.log(`[DEBUG]   process.env["${key}"] = ${val ? `✅ SET (${val.length} chars)` : '❌ MISSING'}`);
      }
    }
  } catch (e: any) {
    console.error('[DEBUG] Error reading .env.local:', e?.message || e);
  }
} else {
  console.log('[DEBUG] .env.local file not found at:', envPath);
}

// Debug: Verify variables are in process.env BEFORE creating constants
console.log('\n[DEBUG] process.env check BEFORE constants:');
console.log(`  process.env.ADMIN_TOKEN: ${process.env.ADMIN_TOKEN ? '✅ (' + process.env.ADMIN_TOKEN.length + ' chars)' : '❌ Missing'}`);
console.log(`  process.env.SHARED_INGEST_SECRET: ${process.env.SHARED_INGEST_SECRET ? '✅ (' + process.env.SHARED_INGEST_SECRET.length + ' chars)' : '❌ Missing'}`);
console.log(`  process.env.WATTBUY_API_KEY: ${process.env.WATTBUY_API_KEY ? '✅ (' + process.env.WATTBUY_API_KEY.length + ' chars)' : '❌ Missing'}`);
console.log(`  process.env.DATABASE_URL: ${process.env.DATABASE_URL ? '✅ (' + process.env.DATABASE_URL.length + ' chars)' : '❌ Missing'}`);

const BASE_URL = process.env.BASE_URL || 'https://intelliwatt.com';
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || '';
const SHARED_INGEST_SECRET = process.env.SHARED_INGEST_SECRET || '';
const WATTBUY_API_KEY = process.env.WATTBUY_API_KEY || '';

// Debug: Check if variables were loaded into constants
console.log('\n[DEBUG] Constants check AFTER assignment:');
console.log(`  ADMIN_TOKEN: ${ADMIN_TOKEN ? '✅ (' + ADMIN_TOKEN.length + ' chars)' : '❌ Missing'}`);
console.log(`  SHARED_INGEST_SECRET: ${SHARED_INGEST_SECRET ? '✅ (' + SHARED_INGEST_SECRET.length + ' chars)' : '❌ Missing'}`);
console.log(`  WATTBUY_API_KEY: ${WATTBUY_API_KEY ? '✅ (' + WATTBUY_API_KEY.length + ' chars)' : '❌ Missing'}`);
console.log(`  DATABASE_URL: ${process.env.DATABASE_URL ? '✅ (' + process.env.DATABASE_URL.length + ' chars)' : '❌ Missing'}`);
console.log('');

interface TestResult {
  name: string;
  passed: boolean;
  error?: string;
  details?: any;
}

const results: TestResult[] = [];

// Helper to wrap database queries with timeout
async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, errorMsg: string): Promise<T> {
  const timeoutPromise = new Promise<never>((_, reject) => {
    setTimeout(() => reject(new Error(`${errorMsg} (timeout after ${timeoutMs}ms)`)), timeoutMs);
  });
  return Promise.race([promise, timeoutPromise]);
}

async function test(name: string, fn: () => Promise<any>, timeoutMs = 60000): Promise<void> {
  try {
    console.log(`\n🧪 Testing: ${name}...`);
    
    // Wrap the test function with timeout
    const testPromise = fn();
    let timeoutHandle: NodeJS.Timeout | null = null;
    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutHandle = setTimeout(() => reject(new Error(`Test timeout after ${timeoutMs}ms`)), timeoutMs);
    });
    
    try {
      const details = await Promise.race([testPromise, timeoutPromise]);
      
      if (timeoutHandle) {
        clearTimeout(timeoutHandle);
        timeoutHandle = null;
      }
      
      results.push({ name, passed: true, details });
      console.log(`✅ PASSED: ${name}`);
      if (details) {
        console.log(`   Details:`, JSON.stringify(details, null, 2).slice(0, 200));
      }
    } finally {
      if (timeoutHandle) {
        clearTimeout(timeoutHandle);
      }
    }
  } catch (e: any) {
    results.push({ name, passed: false, error: e?.message || String(e) });
    console.log(`❌ FAILED: ${name}`);
    console.log(`   Error: ${e?.message || e}`);
  }
  
  // Small delay between tests to avoid overwhelming connections
  await new Promise(resolve => setTimeout(resolve, 100));
}

async function adminFetch(path: string, init: RequestInit = {}, timeoutMs = 30000) {
  const controller = new AbortController();
  let timeoutId: NodeJS.Timeout | null = setTimeout(() => {
    controller.abort();
    timeoutId = null;
  }, timeoutMs);
  
  let res: Response | null = null;
  try {
    const headers: Record<string, string> = {
      'x-admin-token': ADMIN_TOKEN,
      'content-type': 'application/json',
      ...(init.headers as Record<string, string> || {}),
    };
    res = await fetch(`${BASE_URL}${path}`, { 
      ...init, 
      headers,
      signal: controller.signal,
    });
    
    if (timeoutId) {
      clearTimeout(timeoutId);
      timeoutId = null;
    }
    
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
  } catch (e: any) {
    if (timeoutId) {
      clearTimeout(timeoutId);
      timeoutId = null;
    }
    // Ensure response body is consumed to free connection
    if (res && res.body) {
      try {
        await res.body.cancel();
      } catch {
        // Ignore cancel errors
      }
    }
    if (e.name === 'AbortError' || controller.signal.aborted) {
      throw new Error(`Request timeout after ${timeoutMs}ms: ${path}`);
    }
    throw e;
  }
}

async function sharedSecretFetch(path: string, body: any, timeoutMs = 30000) {
  const controller = new AbortController();
  let timeoutId: NodeJS.Timeout | null = setTimeout(() => {
    controller.abort();
    timeoutId = null;
  }, timeoutMs);
  
  let res: Response | null = null;
  try {
    res = await fetch(`${BASE_URL}${path}`, {
      method: 'POST',
      headers: {
        'x-shared-secret': SHARED_INGEST_SECRET,
        'content-type': 'application/json',
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    
    if (timeoutId) {
      clearTimeout(timeoutId);
      timeoutId = null;
    }
    
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
  } catch (e: any) {
    if (timeoutId) {
      clearTimeout(timeoutId);
      timeoutId = null;
    }
    // Ensure response body is consumed to free connection
    if (res && res.body) {
      try {
        await res.body.cancel();
      } catch {
        // Ignore cancel errors
      }
    }
    if (e.name === 'AbortError' || controller.signal.aborted) {
      throw new Error(`Request timeout after ${timeoutMs}ms: ${path}`);
    }
    throw e;
  }
}

// ==================== SMT TESTS ====================

async function testSmtIngestNormalize() {
  if (!SHARED_INGEST_SECRET) {
    throw new Error('SHARED_INGEST_SECRET not set - add to .env.local');
  }

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

  // Verify data in database (if DATABASE_URL is set)
  let dbIntervalsFound = 0;
  let sampleInterval = null;
  if (process.env.DATABASE_URL) {
    const intervals = await withTimeout(
      prisma.smtInterval.findMany({
        where: {
          esiid: testEsiid,
          meter: testMeter,
        },
        orderBy: { ts: 'desc' },
        take: 5,
      }),
      15000,
      'Database query timeout'
    );
    dbIntervalsFound = intervals.length;
    sampleInterval = intervals[0] ? {
      esiid: intervals[0].esiid,
      meter: intervals[0].meter,
      ts: intervals[0].ts,
      kwh: intervals[0].kwh.toString(),
      filled: intervals[0].filled,
    } : null;
  }

  return {
    persisted: result.persisted,
    normalizedPoints: result.normalizedPoints,
    dbIntervalsFound,
    sampleInterval,
    note: process.env.DATABASE_URL ? 'Database verified' : 'Database check skipped (no DATABASE_URL)',
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
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL not set - cannot query database. Add to .env.local');
  }

  const totalIntervals = await withTimeout(prisma.smtInterval.count(), 15000, 'Count query timeout');
  const realIntervals = await withTimeout(
    prisma.smtInterval.count({ where: { filled: false } }),
    15000,
    'Real intervals count timeout'
  );
  const filledIntervals = await withTimeout(
    prisma.smtInterval.count({ where: { filled: true } }),
    15000,
    'Filled intervals count timeout'
  );

  const uniqueEsiids = await withTimeout(
    prisma.$queryRawUnsafe<{ count: bigint }[]>(
      'SELECT COUNT(DISTINCT esiid) as count FROM "SmtInterval"'
    ),
    15000,
    'Unique ESIIDs query timeout'
  );
  const uniqueMeters = await withTimeout(
    prisma.$queryRawUnsafe<{ count: bigint }[]>(
      'SELECT COUNT(DISTINCT meter) as count FROM "SmtInterval"'
    ),
    15000,
    'Unique meters query timeout'
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

  const meterIds = result.meterIds || [];
  if (meterIds.length === 0) {
    console.log(`   ⚠️  WARNING: No meters found for ESIID ${testEsiid} in database`);
    console.log(`   💡 This is expected if no SMT data has been ingested for this ESIID yet`);
  }

  return {
    esiid: result.esiid,
    meterId: result.meterId,
    meterIds: meterIds,
    note: meterIds.length === 0 ? 'No meters found (expected if no data ingested)' : `${meterIds.length} meter(s) found`,
  };
}

async function testWattBuyElectricityProbe() {
  if (!WATTBUY_API_KEY) {
    throw new Error('WATTBUY_API_KEY not set - add to .env.local');
  }

  const addr = '9514 Santa Paula Dr';
  const city = 'Fort Worth';
  const state = 'tx';
  const zip = '76116';

  const q = encodeURIComponent;
  const result = await adminFetch(`/api/admin/wattbuy/electricity-probe?address=${q(addr)}&city=${q(city)}&state=${state}&zip=${zip}`);

  if (result.error) throw new Error(result.error);

  return {
    ok: result.ok,
    status: result.status,
    usedWattkey: result.usedWattkey || false,
    shape: result.shape,
    note: result.usedWattkey ? 'Used wattkey fallback' : 'Direct address lookup',
  };
}

async function testWattBuyRetailRates() {
  if (!WATTBUY_API_KEY) {
    throw new Error('WATTBUY_API_KEY not set - add to .env.local');
  }

  // Test explicit utilityID + state
  const result1 = await adminFetch('/api/admin/wattbuy/retail-rates-test?utilityID=44372&state=tx');
  
  // Test by address (with fallback)
  const addr = '9514 Santa Paula Dr';
  const city = 'Fort Worth';
  const state = 'tx';
  const zip = '76116';
  const q = encodeURIComponent;
  const result2 = await adminFetch(`/api/admin/wattbuy/retail-rates-by-address?address=${q(addr)}&city=${q(city)}&state=${state}&zip=${zip}`);

  return {
    explicit: {
      ok: result1.ok,
      status: result1.status,
      count: result1.count || 0,
    },
    byAddress: {
      ok: result2.ok,
      status: result2.status,
      count: result2.count || 0,
      tried: result2.tried?.length || 0,
    },
    note: result1.count === 0 && result2.count === 0 
      ? 'No retail rates found (may be 204 from WattBuy)' 
      : 'Retail rates retrieved',
  };
}

async function testWattBuyDatabaseCounts() {
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL not set - cannot query database. Add to .env.local');
  }

  const offerMaps = await withTimeout(prisma.offerRateMap.count(), 15000, 'Offer maps count timeout');
  const rateConfigs = await withTimeout(prisma.rateConfig.count(), 15000, 'Rate configs count timeout');
  const masterPlans = await withTimeout(prisma.masterPlan.count(), 15000, 'Master plans count timeout');

  const offerMapsCount = Number(offerMaps);
  const rateConfigsCount = Number(rateConfigs);
  const masterPlansCount = Number(masterPlans);

  if (offerMapsCount === 0 && rateConfigsCount === 0 && masterPlansCount === 0) {
    console.log(`   ⚠️  WARNING: No WattBuy data found in database`);
    console.log(`   💡 This is expected if:`);
    console.log(`      - No WattBuy offers have been synced yet`);
    console.log(`      - The offers sync endpoint hasn't been run`);
    console.log(`      - The database is empty/new`);
  }

  return {
    offerMaps: offerMapsCount,
    rateConfigs: rateConfigsCount,
    masterPlans: masterPlansCount,
    note: (offerMapsCount === 0 && rateConfigsCount === 0 && masterPlansCount === 0)
      ? 'Database empty (no WattBuy data yet)'
      : 'Database contains WattBuy data',
  };
}

// ==================== MAIN ====================

async function runAllTests() {
  console.log('\n🔍 Starting Connection & Database Tests...\n');
  console.log(`Base URL: ${BASE_URL}`);
  console.log(`Admin Token: ${ADMIN_TOKEN ? '✅ Set' : '❌ Missing'}`);
  console.log(`Shared Secret: ${SHARED_INGEST_SECRET ? '✅ Set' : '❌ Missing'}`);
  console.log(`WattBuy API Key: ${WATTBUY_API_KEY ? '✅ Set' : '❌ Missing'}`);
  console.log(`Database URL: ${process.env.DATABASE_URL ? '✅ Set' : '❌ Missing'}`);
  console.log('\n💡 Tip: Add missing env vars to .env.local for full test coverage');

  // SMT Tests (sequential to avoid connection issues)
  await test('SMT: Ingest & Normalize', testSmtIngestNormalize);
  await test('SMT: Daily Summary', testSmtDailySummary);
  await test('SMT: Database Counts', testSmtDatabaseCounts);

  // WattBuy Tests (sequential to avoid connection issues)
  await test('WattBuy: Address → ESIID', testWattBuyAddressResolve);
  await test('WattBuy: ESIID → Meter', testWattBuyEsiidToMeter);
  await test('WattBuy: Electricity Probe', testWattBuyElectricityProbe);
  await test('WattBuy: Retail Rates', testWattBuyRetailRates);
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

  // Return exit code: 0 for success, 1 for failure
  return failed > 0 ? 1 : 0;
}

// Add a global timeout for the entire test suite
const GLOBAL_TIMEOUT = 5 * 60 * 1000; // 5 minutes
let globalTimeoutId: NodeJS.Timeout | null = null;
let isExiting = false;

async function cleanupAndExit(code: number) {
  if (isExiting) return;
  isExiting = true;
  
  if (globalTimeoutId) {
    clearTimeout(globalTimeoutId);
    globalTimeoutId = null;
  }
  
  // Give any pending operations a moment to complete
  await new Promise(resolve => setTimeout(resolve, 200));
  
  try {
    await prisma.$disconnect();
  } catch (e) {
    // Ignore disconnect errors during shutdown
  }
  
  // Additional delay to ensure all connections are closed
  await new Promise(resolve => setTimeout(resolve, 100));
  
  // Exit cleanly
  process.exit(code);
}

globalTimeoutId = setTimeout(() => {
  console.error('\n⏱️  Global timeout: Tests took too long, forcing exit...');
  cleanupAndExit(1);
}, GLOBAL_TIMEOUT);

runAllTests()
  .then((exitCode) => {
    cleanupAndExit(exitCode);
  })
  .catch((e) => {
    console.error('Fatal error:', e);
    cleanupAndExit(1);
  });

