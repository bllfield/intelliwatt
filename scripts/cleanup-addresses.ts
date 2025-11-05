import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function cleanupDuplicateAddresses() {
  console.log('Starting address cleanup...');

  // Get all addresses
  const allAddresses = await prisma.houseAddress.findMany({
    orderBy: { updatedAt: 'desc' }
  });

  console.log(`Found ${allAddresses.length} total addresses`);

  // Group by userId and identify duplicates
  const addressesToKeep = new Map<string, string>();
  const addressesToDelete: string[] = [];

  for (const address of allAddresses) {
    const existing = addressesToKeep.get(address.userId);
    if (!existing) {
      // Keep this one (most recent for this user)
      addressesToKeep.set(address.userId, address.id);
      console.log(`Keeping address for ${address.userId}: ${address.addressLine1}`);
    } else {
      // Mark for deletion
      addressesToDelete.push(address.id);
      console.log(`Marking for deletion: ${address.addressLine1} (user: ${address.userId})`);
    }
  }

  console.log(`\nWill keep ${addressesToKeep.size} addresses`);
  console.log(`Will delete ${addressesToDelete.length} duplicate addresses\n`);

  // Delete the duplicates
  let deletedCount = 0;
  if (addressesToDelete.length > 0) {
    for (const id of addressesToDelete) {
      await prisma.houseAddress.delete({
        where: { id }
      });
      deletedCount++;
    }
  }

  console.log(`Cleanup complete! Deleted ${deletedCount} duplicate addresses.`);

  // Show final summary
  const finalAddresses = await prisma.houseAddress.findMany({
    orderBy: { updatedAt: 'desc' }
  });

  console.log(`\nFinal state: ${finalAddresses.length} addresses across ${addressesToKeep.size} users\n`);
  
  for (const [userId, addressId] of Array.from(addressesToKeep.entries())) {
    const address = finalAddresses.find(a => a.id === addressId);
    if (address) {
      console.log(`${userId}: ${address.addressLine1}, ${address.addressCity}, ${address.addressState}`);
    }
  }
}

cleanupDuplicateAddresses()
  .catch((error) => {
    console.error('Error during cleanup:', error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
