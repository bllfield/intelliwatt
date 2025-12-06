const { PrismaClient } = require('../node_modules/@prisma/client');

const url = 'postgresql://doadmin:AVNS_lUXcN2ftFFu6XUIc5G0@db-postgresql-nyc3-37693-do-user-27496845-0.k.db.ondigitalocean.com:25060/app-pool?sslmode=require';
const prisma = new PrismaClient({ datasources: { db: { url } } });

const query = `
WITH keep_emails AS (
  SELECT UNNEST(ARRAY[
    'csuttle@pegasusresidential.com',
    'pharrison@ilcenter.org',
    'zander86@gmail.com',
    'erhamilton@messer.com',
    'whill@hilltrans.com',
    'cgoldstein@seia.com',
    'omoneo@o2epcm.com'
  ]) AS email
)
SELECT
  (SELECT count(*) FROM "User") AS users_total,
  (SELECT count(*) FROM "User" WHERE email IN (SELECT email FROM keep_emails)) AS users_whitelist,
  (SELECT count(*) FROM "HouseAddress") AS houses_total,
  (SELECT count(*) FROM "SmtAuthorization") AS smt_auth_total,
  (SELECT count(*) FROM "SmtInterval") AS smt_interval_total,
  (SELECT count(*) FROM "SmtBillingRead") AS smt_billing_total;
`;

(async () => {
  try {
    const rows = await prisma.$queryRawUnsafe(query);
    const normalized = rows.map((row) =>
      Object.fromEntries(
        Object.entries(row).map(([key, value]) => [key, typeof value === 'bigint' ? Number(value) : value]),
      ),
    );
    console.log(JSON.stringify(normalized, null, 2));
  } catch (err) {
    console.error(err);
  } finally {
    await prisma.$disconnect();
  }
})();
