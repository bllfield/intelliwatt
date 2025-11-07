import https from 'https';

function must(name) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env: ${name}`);
  return v;
}

const ADMIN_TOKEN = must('ADMIN_TOKEN');
const CRON_SECRET = process.env.CRON_SECRET || '';
const BASE = process.env.PROD_BASE_URL || 'https://intelliwatt.com';

function get(url, headers = {}) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, {
      headers,
      rejectUnauthorized: process.env.NODE_TLS_REJECT_UNAUTHORIZED !== '0',
    }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const body = Buffer.concat(chunks).toString('utf8');
        resolve({ status: res.statusCode, body });
      });
    });
    req.on('error', reject);
  });
}

(async () => {
  try {
    console.log('== Smoke: fetch-latest (expect 200 or 400 if URL missing) ==');
    const url1 = `${BASE}/api/admin/ercot/fetch-latest?url=https://example.com/dummy.txt&notes=smoke`;
    const r1 = await get(url1, { 'x-admin-token': ADMIN_TOKEN });
    console.log('Status:', r1.status);
    console.log('Body:', r1.body.slice(0, 500));

    console.log('\n== Smoke: cron route (token path) ==');
    if (CRON_SECRET) {
      const url2 = `${BASE}/api/admin/ercot/cron?token=${encodeURIComponent(CRON_SECRET)}`;
      const r2 = await get(url2);
      console.log('Status:', r2.status);
      console.log('Body:', r2.body.slice(0, 500));
    } else {
      console.log('Skipped cron smoke (no CRON_SECRET set).');
    }

    console.log('\n== Done ==');
    process.exit(0);
  } catch (e) {
    console.error('SMOKE ERROR:', e?.message || e);
    process.exit(1);
  }
})();
