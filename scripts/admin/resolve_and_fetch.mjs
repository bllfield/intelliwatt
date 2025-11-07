import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import https from 'https';
import { config as dotenvConfig } from 'dotenv';

const root = process.cwd();
for (const rel of ['.env.local', '.env', '.env.production.local', '.vercel/.env.production.local']) {
  const full = path.join(root, rel);
  if (fs.existsSync(full)) {
    dotenvConfig({ path: full, override: false });
  }
}

const ADMIN_TOKEN = process.env.ADMIN_TOKEN;
const BASE = process.env.PROD_BASE_URL || 'https://intelliwatt.com';
const PAGE_URL = process.env.ERCOT_PAGE_URL;

if (!ADMIN_TOKEN) throw new Error('Missing ADMIN_TOKEN');
if (!PAGE_URL) throw new Error('Missing ERCOT_PAGE_URL');

function httpGet(url, headers = {}) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers }, (res) => {
      const bufs = [];
      res.on('data', (chunk) => bufs.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk));
      res.on('end', () => {
        resolve({ status: res.statusCode || 0, body: Buffer.concat(bufs).toString('utf8') });
      });
    });
    req.on('error', reject);
    req.setTimeout(30000, () => req.destroy(new Error('Request timeout')));
  });
}

const target = `${BASE}/api/admin/ercot/fetch-latest?pageUrl=${encodeURIComponent(PAGE_URL)}&notes=resolve-cli`;
const response = await httpGet(target, { 'x-admin-token': ADMIN_TOKEN });
console.log('Status:', response.status);
console.log('Body:', response.body.slice(0, 600));
if (response.status !== 200) process.exit(1);
