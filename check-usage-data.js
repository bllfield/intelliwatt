const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  console.log('\n=== Checking SMT Interval Data ===\n');
  
  // Check what ESIIDs have data
  const esiidCounts = await prisma.$queryRaw`
    SELECT esiid, 
           COUNT(*)::int as interval_count,
           MIN(ts) as earliest,
           MAX(ts) as latest,
           SUM(kwh)::float as total_kwh
    FROM "SmtInterval"
    GROUP BY esiid
    ORDER BY interval_count DESC
  `;
  
  console.log('ESIIDs with SMT interval data:');
  for (const row of esiidCounts) {
    console.log(`  ESIID: ${row.esiid}`);
    console.log(`    Intervals: ${row.interval_count}`);
    console.log(`    Date Range: ${row.earliest?.toISOString()} to ${row.latest?.toISOString()}`);
    console.log(`    Total kWh: ${row.total_kwh}`);
    console.log('');
  }
  
  console.log('\n=== Checking User Houses ===\n');
  
  // Get all house addresses
  const houses = await prisma.houseAddress.findMany({
    where: { archivedAt: null },
    select: {
      id: true,
      userId: true,
      userEmail: true,
      label: true,
      addressLine1: true,
      esiid: true,
    },
    take: 20, // Limit to first 20 houses
  });
  
  console.log(`Found ${houses.length} houses:`);
  for (const house of houses) {
    console.log(`\nHouse: ${house.label || house.addressLine1}`);
    console.log(`  User: ${house.userEmail || house.userId}`);
    console.log(`  ESIID: ${house.esiid || 'NOT SET'}`);
    
    // Check if this ESIID has data
    if (house.esiid) {
      const matchingData = esiidCounts.find(e => e.esiid === house.esiid);
      if (matchingData) {
        console.log(`  ✓ HAS ${matchingData.interval_count} intervals in SmtInterval table`);
      } else {
        console.log(`  ✗ NO DATA in SmtInterval table`);
        // Check if there's a close match (with or without leading quote)
        const withQuote = `'${house.esiid}`;
        const withoutQuote = house.esiid.replace(/^'+/, '');
        const quoteMatch = esiidCounts.find(e => e.esiid === withQuote || e.esiid === withoutQuote);
        if (quoteMatch) {
          console.log(`  ⚠ BUT FOUND DATA for related ESIID: ${quoteMatch.esiid} (${quoteMatch.interval_count} intervals)`);
        }
      }
    }
  }
  
  await prisma.$disconnect();
}

main().catch(console.error);
