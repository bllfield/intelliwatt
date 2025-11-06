// scripts/admin/smoke.ts
// Backend smoke tests for admin endpoints
// Usage: npm run admin:summary | npm run admin:catch
//
// Setup:
// 1. Copy .env.local.example to .env.local
// 2. Fill in ADMIN_TOKEN and CRON_SECRET values
// 3. Run: npm install (to install tsx and dotenv)
// 4. Run: npm run admin:summary or npm run admin:catch

import { config } from 'dotenv';
import { resolve } from 'path';

// Load .env.local if it exists
config({ path: resolve(process.cwd(), '.env.local') });

const BASE_URL = process.env.NEXT_PUBLIC_APP_URL || 'https://intelliwatt.com';
const ADMIN_TOKEN = process.env.ADMIN_TOKEN;
const CRON_SECRET = process.env.CRON_SECRET;

function log(message: string, data?: any) {
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] ${message}`);
  if (data) {
    console.log(JSON.stringify(data, null, 2));
  }
}

function error(message: string, err?: any) {
  const timestamp = new Date().toISOString();
  console.error(`[${timestamp}] ERROR: ${message}`);
  if (err) {
    console.error(err);
  }
  process.exit(1);
}

async function testDailySummary() {
  if (!ADMIN_TOKEN) {
    error('ADMIN_TOKEN not set in environment');
  }

  log('Testing daily-summary endpoint...');
  const url = `${BASE_URL}/api/admin/analysis/daily-summary`;

  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'x-admin-token': ADMIN_TOKEN as string,
      },
    });

    const data = await response.json();
    const duration = response.headers.get('x-response-time') || 'N/A';

    if (!response.ok) {
      error(`Request failed with status ${response.status}`, data);
    }

    log('✓ Daily summary test passed', {
      status: response.status,
      corrId: data.corrId,
      rowCount: data.rows?.length || 0,
      sample: data.rows?.[0] || null,
    });

    return data;
  } catch (err: any) {
    error('Request failed', err);
  }
}

async function testCatchUp() {
  if (!CRON_SECRET) {
    error('CRON_SECRET not set in environment');
  }

  log('Testing normalize-smt-catch endpoint...');
  const url = `${BASE_URL}/api/admin/cron/normalize-smt-catch`;

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'x-vercel-cron': '1',
        'x-cron-secret': CRON_SECRET as string,
      },
    });

    const data = await response.json();

    if (!response.ok) {
      error(`Request failed with status ${response.status}`, data);
    }

    log('✓ Catch-up test passed', {
      status: response.status,
      corrId: data.corrId,
      checkedDays: data.checkedDays,
      missingDays: data.missingDays,
      processed: data.processed,
    });

    return data;
  } catch (err: any) {
    error('Request failed', err);
  }
}

// Main
const command = process.argv[2];

if (command === 'summary') {
  testDailySummary()
    .then(() => {
      log('Test completed successfully');
      process.exit(0);
    })
    .catch((err) => {
      error('Test failed', err);
    });
} else if (command === 'catch') {
  testCatchUp()
    .then(() => {
      log('Test completed successfully');
      process.exit(0);
    })
    .catch((err) => {
      error('Test failed', err);
    });
} else {
  error('Usage: npm run admin:summary | npm run admin:catch');
}

