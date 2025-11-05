import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function checkAddresses() {
  try {
    const addresses = await prisma.houseAddress.findMany({
      orderBy: { updatedAt: 'desc' }
    });

    console.log(`\nTotal addresses: ${addresses.length}\n`);
    console.log('==========================================');
    
    for (const addr of addresses) {
      console.log(`\nUser ID: ${addr.userId}`);
      console.log(`Address: ${addr.addressLine1}`);
      if (addr.addressLine2) console.log(`Line 2: ${addr.addressLine2}`);
      console.log(`City: ${addr.addressCity}`);
      console.log(`State: ${addr.addressState}`);
      console.log(`Zip: ${addr.addressZip5}`);
      console.log(`Validation: ${addr.validationSource}`);
      console.log(`ESIID: ${addr.esiid || 'Not set'}`);
      console.log(`Created: ${addr.createdAt}`);
      console.log(`Updated: ${addr.updatedAt}`);
      console.log('------------------------------------------');
    }
    
    // Also get associated users
    console.log('\n\nUser information:');
    const userIds = Array.from(new Set(addresses.map(a => a.userId)));
    for (const userId of userIds) {
      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { email: true }
      });
      console.log(`${userId} -> ${user?.email || 'Unknown'}`);
    }
    
  } catch (error) {
    console.error('Error:', error);
  } finally {
    await prisma.$disconnect();
  }
}

checkAddresses();


