const { Client } = require('pg');
const fs = require('fs');

const baseUrl = 'postgresql://doadmin:AVNS_lUXcN2ftFFu6XUIc5G0@db-postgresql-nyc3-37693-do-user-27496845-0.k.db.ondigitalocean.com:25060/app-pool';
const sql = fs.readFileSync('scripts/db_summary.sql', 'utf8');

(async () => {
  const client = new Client({ connectionString: baseUrl, ssl: { rejectUnauthorized: false } });
  try {
    await client.connect();
    const res = await client.query(sql);
    console.log(JSON.stringify(res.rows, null, 2));
  } catch (err) {
    console.error(err);
  } finally {
    await client.end();
  }
})();
