const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const esiid = '10443720004529147';
  
  console.log(`\n=== Investigating ESIID: ${esiid} ===\n`);
  
  // Get daily totals to see the pattern
  const dailyTotals = await prisma.$queryRaw`
    SELECT 
      DATE("ts") as date,
      COUNT(*)::int as interval_count,
      SUM("kwh")::float as total_kwh,
      MIN("ts") as first_ts,
      MAX("ts") as last_ts,
      "source"
    FROM "SmtInterval"
    WHERE "esiid" = ${esiid}
    GROUP BY DATE("ts"), "source"
    ORDER BY date DESC
    LIMIT 50
  `;
  
  console.log('Daily totals (most recent 50 days):');
  console.log('Date | Intervals | Total kWh | First | Last | Source');
  console.log('-'.repeat(100));
  for (const day of dailyTotals) {
    const date = day.date.toISOString().split('T')[0];
    const first = day.first_ts.toISOString().substring(11, 16);
    const last = day.last_ts.toISOString().substring(11, 16);
    console.log(`${date} | ${day.interval_count.toString().padStart(9)} | ${day.total_kwh.toFixed(3).padStart(9)} | ${first} | ${last} | ${day.source || 'null'}`);
  }
  
  console.log('\n=== Checking for duplicate timestamps ===\n');
  
  // Check for duplicates
  const duplicates = await prisma.$queryRaw`
    SELECT "ts", "meter", COUNT(*)::int as count, 
           ARRAY_AGG("kwh"::float) as kwh_values,
           ARRAY_AGG("source") as sources
    FROM "SmtInterval"
    WHERE "esiid" = ${esiid}
    GROUP BY "ts", "meter"
    HAVING COUNT(*) > 1
    ORDER BY "ts" DESC
    LIMIT 20
  `;
  
  if (duplicates.length > 0) {
    console.log(`Found ${duplicates.length} duplicate timestamps:`);
    for (const dup of duplicates) {
      console.log(`  ${dup.ts.toISOString()}: ${dup.count} records, kWh values: ${dup.kwh_values.join(', ')}, sources: ${dup.sources.join(', ')}`);
    }
  } else {
    console.log('No duplicate timestamps found (good!)');
  }
  
  console.log('\n=== Checking RawSmtFile records ===\n');
  
  // Check what raw files exist
  const rawFiles = await prisma.rawSmtFile.findMany({
    orderBy: { created_at: 'desc' },
    take: 10,
    select: {
      id: true,
      filename: true,
      size_bytes: true,
      created_at: true,
      source: true,
      content: true,
    },
  });
  
  console.log(`Found ${rawFiles.length} recent raw SMT files:`);
  for (const file of rawFiles) {
    console.log(`\n  File: ${file.filename}`);
    console.log(`    Created: ${file.created_at.toISOString()}`);
    console.log(`    Source: ${file.source}`);
    console.log(`    Size: ${file.size_bytes} bytes`);
    
    // Check if this file has been normalized
    if (file.content) {
      const content = Buffer.from(file.content).toString('utf8');
      const lines = content.split('\n');
      console.log(`    Lines: ${lines.length}`);
      
      // Show first few lines
      console.log(`    First line: ${lines[0]?.substring(0, 100)}`);
      if (lines[1]) console.log(`    Second line: ${lines[1]?.substring(0, 100)}`);
    }
  }
  
  console.log('\n=== Checking for gaps in data ===\n');
  
  // Find gaps in the data (more than 1 hour between intervals)
  const gaps = await prisma.$queryRaw`
    WITH intervals AS (
      SELECT 
        "ts",
        LAG("ts") OVER (ORDER BY "ts") as prev_ts
      FROM "SmtInterval"
      WHERE "esiid" = ${esiid}
    )
    SELECT 
      prev_ts as gap_start,
      "ts" as gap_end,
      EXTRACT(EPOCH FROM ("ts" - prev_ts))/3600 as hours_gap
    FROM intervals
    WHERE prev_ts IS NOT NULL 
      AND "ts" - prev_ts > INTERVAL '2 hours'
    ORDER BY gap_start DESC
    LIMIT 20
  `;
  
  if (gaps.length > 0) {
    console.log(`Found ${gaps.length} gaps > 2 hours:`);
    for (const gap of gaps) {
      console.log(`  Gap: ${gap.gap_start.toISOString()} to ${gap.gap_end.toISOString()} (${gap.hours_gap.toFixed(1)} hours)`);
    }
  } else {
    console.log('No significant gaps found');
  }
  
  await prisma.$disconnect();
}

main().catch(console.error);
