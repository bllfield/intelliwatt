import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const esiid = '10443720004895510';
  
  console.log(`\n=== Checking SMT data for ESIID ${esiid} ===\n`);
  
  // Check RawSmtFile records via SmtBillingRead
  console.log('📁 RawSmtFile records (via billing reads):');
  try {
    const billing = await prisma.smtBillingRead.findMany({
      where: { esiid },
      include: {
        rawSmtFile: true
      },
      orderBy: { createdAt: 'desc' },
      take: 5,
    });
    console.log(`Found ${billing.length} billing reads with files`);
    billing.forEach(b => {
      if (b.rawSmtFile) {
        console.log(`  - ${b.rawSmtFile.filename} (${b.rawSmtFile.size_bytes} bytes, ${b.rawSmtFile.received_at})`);
      }
    });
  } catch (error) {
    console.log('Error:', error.message);
  }
  
  // Check SmtInterval records
  console.log('\n📊 SmtInterval records (master table):');
  try {
    const intervals = await prisma.smtInterval.findMany({
      where: { esiid },
      orderBy: { ts: 'desc' },
      take: 10,
    });
    console.log(`Found ${intervals.length} intervals`);
    intervals.forEach(i => {
      console.log(`  - ${i.ts}: ${i.kwh} kWh (meter: ${i.meter})`);
    });
  } catch (error) {
    console.log('Error:', error.message);
  }
  
  // Check SmtBillingRead records
  console.log('\n💰 SmtBillingRead records:');
  try {
    const billing = await prisma.smtBillingRead.findMany({
      where: { esiid },
      orderBy: { readStart: 'desc' },
      take: 5,
    });
    console.log(`Found ${billing.length} billing records`);
    billing.forEach(b => {
      console.log(`  - ${b.readStart} to ${b.readEnd}: ${b.tdspName || 'N/A'}`);
    });
  } catch (error) {
    console.log('Error:', error.message);
  }
  
  // Check if data exists by date range
  console.log('\n📅 Interval counts by month:');
  try {
    const monthCounts = await prisma.$queryRaw`
      SELECT DATE_TRUNC('month', ts)::date as month, COUNT(*) as count
      FROM "SmtInterval"
      WHERE esiid = ${esiid}
      GROUP BY DATE_TRUNC('month', ts)
      ORDER BY month DESC
      LIMIT 12
    `;
    if (monthCounts.length === 0) {
      console.log('No intervals found for this ESIID');
    } else {
      monthCounts.forEach(row => {
        console.log(`  - ${row.month}: ${row.count} intervals`);
      });
    }
  } catch (error) {
    console.log('Error:', error.message);
  }
  
  await prisma.$disconnect();
}

main().catch(e => {
  console.error('Error:', e.message);
  process.exit(1);
});
