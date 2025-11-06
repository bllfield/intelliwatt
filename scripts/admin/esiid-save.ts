// scripts/admin/esiid-save.ts

// From Cursor terminal:

//   npm run esiid:resolve-save -- <houseId> "<line1>" "<city>" "<state>" "<zip>"

//   npm run esiid:save -- <houseId> <esiid>

import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';

// Load .env.local if it exists (with UTF-16 encoding support)
const envPath = resolve(process.cwd(), '.env.local');
if (existsSync(envPath)) {
  try {
    const buffer = readFileSync(envPath);
    let envContent: string;
    
    if (buffer.length >= 2 && buffer[0] === 0xFF && buffer[1] === 0xFE) {
      envContent = buffer.toString('utf16le');
    } else if (buffer.length >= 2 && buffer[0] === 0xFE && buffer[1] === 0xFF) {
      envContent = buffer.swap16().toString('utf16le');
    } else {
      envContent = buffer.toString('utf-8');
      if (envContent.charCodeAt(0) === 0xFEFF) {
        envContent = envContent.slice(1);
      }
    }
    
    for (const line of envContent.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (trimmed && !trimmed.startsWith('#')) {
        const equalIndex = trimmed.indexOf('=');
        if (equalIndex > 0) {
          const key = trimmed.substring(0, equalIndex).trim();
          let value = trimmed.substring(equalIndex + 1).trim();
          
          if ((value.startsWith('"') && value.endsWith('"')) || 
              (value.startsWith("'") && value.endsWith("'"))) {
            value = value.slice(1, -1);
          }
          
          if (key) {
            process.env[key] = value;
          }
        }
      }
    }
  } catch (e) {
    // .env.local exists but can't be read, that's fine
  }
}

const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';

const ADMIN_TOKEN = process.env.ADMIN_TOKEN || '';

if (!ADMIN_TOKEN) { console.error('Missing ADMIN_TOKEN in env'); process.exit(1); }



async function post(path: string, body: any) {

  const res = await fetch(`${BASE_URL}${path}`, {

    method: 'POST',

    headers: { 'content-type': 'application/json', 'x-admin-token': ADMIN_TOKEN },

    body: JSON.stringify(body),

  });

  const text = await res.text();

  let json: any; try { json = JSON.parse(text); } catch { json = { raw: text }; }

  if (!res.ok) throw new Error(`HTTP ${res.status}: ${text}`);

  return json;

}



(async () => {
  console.log(`\nUsing BASE_URL: ${BASE_URL}`);

  const mode = process.argv[2];

  if (mode === 'resolve-save') {

    const [ , , , houseId, line1, city, state, zip ] = process.argv;

    if (!houseId || !line1 || !city || !state || !zip) {

      console.error('Usage: npm run esiid:resolve-save -- <houseId> "<line1>" "<city>" "<state>" "<zip>"');

      process.exit(1);

    }

    try {
      const json = await post('/api/admin/address/resolve-and-save', { houseId, line1, city, state, zip });
      console.log('\n=== RESOLVE & SAVE ===\n', JSON.stringify(json, null, 2));
    } catch (err: any) {
      console.error('\n❌ RESOLVE & SAVE FAILED\n', err?.message ?? err);
      process.exit(1);
    }

  } else if (mode === 'save') {

    const [ , , , houseId, esiid ] = process.argv;

    if (!houseId || !esiid) {

      console.error('Usage: npm run esiid:save -- <houseId> <esiid>');

      process.exit(1);

    }

    try {
      const json = await post('/api/admin/address/save-esiid', { houseId, esiid });
      console.log('\n=== SAVE ESIID ===\n', JSON.stringify(json, null, 2));
    } catch (err: any) {
      console.error('\n❌ SAVE ESIID FAILED\n', err?.message ?? err);
      process.exit(1);
    }

  } else {

    console.error('Usage:\n  npm run esiid:resolve-save -- <houseId> "<line1>" "<city>" "<state>" "<zip>"\n  npm run esiid:save -- <houseId> <esiid>');

    process.exit(1);

  }

})();
