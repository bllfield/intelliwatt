const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  console.log('\n=== Checking SMT Authorizations ===\n');
  
  const authorizations = await prisma.smtAuthorization.findMany({
    select: {
      id: true,
      esiid: true,
      smtStatus: true,
      createdAt: true,
      updatedAt: true,
      userId: true,
      houseAddressId: true,
      smtAgreementId: true,
      smtSubscriptionId: true,
    },
    orderBy: { createdAt: 'desc' },
  });
  
  console.log(`Found ${authorizations.length} SMT authorizations:\n`);
  
  for (const auth of authorizations) {
    console.log(`ESIID: ${auth.esiid}`);
    console.log(`  User ID: ${auth.userId}`);
    console.log(`  House ID: ${auth.houseAddressId || 'None'}`);
    console.log(`  SMT Status: ${auth.smtStatus || 'Unknown'}`);
    console.log(`  Agreement ID: ${auth.smtAgreementId || 'None'}`);
    console.log(`  Subscription ID: ${auth.smtSubscriptionId || 'None'}`);
    console.log(`  Created: ${auth.createdAt.toISOString()}`);
    console.log(`  Updated: ${auth.updatedAt.toISOString()}`);
    
    // Check if this ESIID has data in SmtInterval
    const intervalCount = await prisma.smtInterval.count({
      where: { esiid: auth.esiid }
    });
    console.log(`  Data in SmtInterval: ${intervalCount} records`);
    
    // Get user email
    if (auth.userId) {
      const user = await prisma.user.findUnique({
        where: { id: auth.userId },
        select: { email: true }
      });
      console.log(`  User Email: ${user?.email || 'Unknown'}`);
    }
    
    console.log('');
  }
  
  console.log('\n=== Checking what ESIIDs are in raw files ===\n');
  
  // Get a few recent raw files and check their content
  const rawFiles = await prisma.rawSmtFile.findMany({
    where: {
      content: { not: null },
      size_bytes: { gt: 1000 }, // Get files with actual data
    },
    orderBy: { created_at: 'desc' },
    take: 5,
    select: {
      filename: true,
      created_at: true,
      content: true,
    },
  });
  
  console.log(`Checking ${rawFiles.length} recent files with content:\n`);
  
  for (const file of rawFiles) {
    if (file.content) {
      const content = Buffer.from(file.content).toString('utf8');
      const lines = content.split('\n');
      const dataRow = lines[1]; // First data row after header
      
      if (dataRow) {
        // Extract ESIID from first column
        const match = dataRow.match(/^'?(\d{17})/);
        if (match) {
          console.log(`File: ${file.filename}`);
          console.log(`  ESIID: ${match[1]}`);
          console.log(`  Created: ${file.created_at.toISOString()}`);
          console.log(`  Rows: ${lines.length - 1}`);
          console.log('');
        }
      }
    }
  }
  
  console.log('\n=== Summary ===\n');
  console.log('To get data for your accounts, you need to:');
  console.log('1. Create SMT authorizations for your real ESIIDs');
  console.log('2. Wait for SMT to deliver files to the SFTP server');
  console.log('3. The SFTP fetch script will download and process them');
  
  await prisma.$disconnect();
}

main().catch(console.error);
