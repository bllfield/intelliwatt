// scripts/admin/esiid-save.ts

// From Cursor terminal:

//   npm run esiid:resolve-save -- <houseId> "<line1>" "<city>" "<state>" "<zip>"

//   npm run esiid:save -- <houseId> <esiid>

const BASE_URL = process.env.BASE_URL || 'https://intelliwatt.com';

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

  const mode = process.argv[2];

  if (mode === 'resolve-save') {

    const [ , , , houseId, line1, city, state, zip ] = process.argv;

    if (!houseId || !line1 || !city || !state || !zip) {

      console.error('Usage: npm run esiid:resolve-save -- <houseId> "<line1>" "<city>" "<state>" "<zip>"');

      process.exit(1);

    }

    const json = await post('/api/admin/address/resolve-and-save', { houseId, line1, city, state, zip });

    console.log('\n=== RESOLVE & SAVE ===\n', JSON.stringify(json, null, 2));

  } else if (mode === 'save') {

    const [ , , , houseId, esiid ] = process.argv;

    if (!houseId || !esiid) {

      console.error('Usage: npm run esiid:save -- <houseId> <esiid>');

      process.exit(1);

    }

    const json = await post('/api/admin/address/save-esiid', { houseId, esiid });

    console.log('\n=== SAVE ESIID ===\n', JSON.stringify(json, null, 2));

  } else {

    console.error('Usage:\n  npm run esiid:resolve-save -- <houseId> "<line1>" "<city>" "<state>" "<zip>"\n  npm run esiid:save -- <houseId> <esiid>');

    process.exit(1);

  }

})();
