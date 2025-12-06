const { PrismaClient } = require('../node_modules/@prisma/client');

const url = 'postgresql://doadmin:AVNS_lUXcN2ftFFu6XUIc5G0@db-postgresql-nyc3-37693-do-user-27496845-0.k.db.ondigitalocean.com:25060/app-pool?sslmode=require';
const prisma = new PrismaClient({ datasources: { db: { url } } });

const emails = [
  'csuttle@pegasusresidential.com',
  'pharrison@ilcenter.org',
  'zander86@gmail.com',
  'erhamilton@messer.com',
  'whill@hilltrans.com',
  'cgoldstein@seia.com',
  'omoneo@o2epcm.com',
];

(async () => {
  try {
    for (const email of emails) {
      const user = await prisma.user.upsert({
        where: { email },
        update: {},
        create: { email },
      });
      console.log(`upserted ${email} -> ${user.id}`);
    }
  } catch (err) {
    console.error(err);
  } finally {
    await prisma.$disconnect();
  }
})();
