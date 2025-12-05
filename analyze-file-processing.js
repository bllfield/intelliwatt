const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  console.log('\n=== Analyzing Recent File Processing ===\n');
  
  // Get all raw files from the last 7 days
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  
  const rawFiles = await prisma.rawSmtFile.findMany({
    where: {
      created_at: { gte: sevenDaysAgo }
    },
    orderBy: { created_at: 'desc' },
    select: {
      id: true,
      filename: true,
      created_at: true,
      size_bytes: true,
      source: true,
      sha256: true,
      content: true,
      storage_path: true,
    },
  });
  
  console.log(`Found ${rawFiles.length} files uploaded in last 7 days:\n`);
  
  // Group by date
  const byDate = {};
  for (const file of rawFiles) {
    const date = file.created_at.toISOString().split('T')[0];
    if (!byDate[date]) byDate[date] = [];
    byDate[date].push(file);
  }
  
  for (const [date, files] of Object.entries(byDate).sort().reverse()) {
    console.log(`\n${date}: ${files.length} files`);
    
    for (const file of files) {
      const hasContent = file.content ? '✓ has content' : '✗ content is NULL (in S3)';
      const size = `${file.size_bytes} bytes`;
      const time = file.created_at.toISOString().substring(11, 19);
      console.log(`  ${time} - ${file.filename.substring(0, 60)}... (${size}) ${hasContent}`);
      
      // If file has content, try to extract ESIID
      if (file.content && file.size_bytes > 500) {
        try {
          const content = Buffer.from(file.content).toString('utf8');
          const lines = content.split('\n');
          if (lines.length > 1) {
            const match = lines[1].match(/^'?(\d{17})/);
            if (match) {
              const esiid = match[1];
              console.log(`      → ESIID: ${esiid}`);
              
              // Check if this was normalized
              const intervalCount = await prisma.smtInterval.count({
                where: { 
                  esiid: esiid,
                  createdAt: { gte: file.created_at }
                }
              });
              
              if (intervalCount > 0) {
                console.log(`      → ✓ Normalized: ${intervalCount} intervals created`);
              } else {
                console.log(`      → ✗ NOT normalized or was duplicate`);
              }
            }
          }
        } catch (err) {
          console.log(`      → Error reading content: ${err.message}`);
        }
      }
    }
  }
  
  console.log('\n=== Checking for files that should have been normalized but weren\'t ===\n');
  
  // Find files with content that have no corresponding SmtInterval records created after them
  const filesWithContent = rawFiles.filter(f => f.content && f.size_bytes > 500);
  console.log(`Files with content (${filesWithContent.length}):\n`);
  
  for (const file of filesWithContent) {
    const content = Buffer.from(file.content).toString('utf8');
    const lines = content.split('\n');
    if (lines.length > 1) {
      const match = lines[1].match(/^'?(\d{17})/);
      if (match) {
        const esiid = match[1];
        
        // Count intervals for this ESIID created around the time of this file
        const beforeCount = await prisma.smtInterval.count({
          where: { 
            esiid: esiid,
            createdAt: { lt: file.created_at }
          }
        });
        
        const afterCount = await prisma.smtInterval.count({
          where: { 
            esiid: esiid,
            createdAt: { gte: file.created_at }
          }
        });
        
        const dataRows = lines.length - 1;
        
        if (afterCount === 0 && dataRows > 0) {
          console.log(`⚠ File NOT normalized: ${file.filename.substring(0, 50)}...`);
          console.log(`  ESIID: ${esiid}`);
          console.log(`  Uploaded: ${file.created_at.toISOString()}`);
          console.log(`  Data rows: ${dataRows}`);
          console.log(`  Intervals before upload: ${beforeCount}`);
          console.log(`  Intervals after upload: ${afterCount}`);
          console.log('');
        }
      }
    }
  }
  
  await prisma.$disconnect();
}

main().catch(console.error);
