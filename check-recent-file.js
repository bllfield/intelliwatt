const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  // Get the most recent large file (likely has real data)
  const file = await prisma.rawSmtFile.findFirst({
    where: { 
      size_bytes: { gt: 20000 } // Get a large file with actual data
    },
    orderBy: { created_at: 'desc' },
    select: {
      id: true,
      filename: true,
      size_bytes: true,
      created_at: true,
      content: true,
    },
  });
  
  if (!file) {
    console.log('No large files found');
    return;
  }
  
  console.log(`\nFile: ${file.filename}`);
  console.log(`Size: ${file.size_bytes} bytes`);
  console.log(`Created: ${file.created_at.toISOString()}`);
  
  if (!file.content) {
    console.log('\nContent is NULL (stored in S3)');
    console.log('Cannot read S3 files from this script');
    
    // Instead, let's manually call normalize on this file
    console.log('\nTrying to normalize this file via API...');
    return;
  }
  
  console.log('\nFirst 20 lines:\n');
  
  const content = Buffer.from(file.content).toString('utf8');
  const lines = content.split('\n').slice(0, 20);
  
  for (let i = 0; i < lines.length; i++) {
    console.log(`${i}: ${lines[i]}`);
  }
  
  // Count how many data rows
  const allLines = content.split('\n');
  console.log(`\nTotal lines: ${allLines.length}`);
  console.log(`Data rows: ${allLines.length - 1} (excluding header)`);
  
  // Extract ESIID from first data row
  if (allLines.length > 1) {
    const firstDataRow = allLines[1];
    const esiidMatch = firstDataRow.match(/^'?([0-9]{17})/);
    if (esiidMatch) {
      console.log(`\nESIID found: ${esiidMatch[1]}`);
      
      // Check if this ESIID has data in SmtInterval
      const count = await prisma.smtInterval.count({
        where: { esiid: esiidMatch[1] }
      });
      console.log(`SmtInterval records for this ESIID: ${count}`);
    }
  }
  
  await prisma.$disconnect();
}

main().catch(console.error);
