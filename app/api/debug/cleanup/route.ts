import { NextRequest, NextResponse } from "next/server";
import { guardAdmin } from '@/lib/auth/admin';
import { prisma } from "@/lib/db";

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  const gate = guardAdmin(request);
  if (gate) return gate;
  
  try {
    console.log('Starting address cleanup...');

    // Get all addresses
    const allAddresses = await prisma.houseAddress.findMany({
      orderBy: { updatedAt: 'desc' }
    });

    console.log(`Found ${allAddresses.length} total addresses`);

    // Group by userId and keep only the most recent for each user
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

    console.log(`Will keep ${addressesToKeep.size} addresses`);
    console.log(`Will delete ${addressesToDelete.length} duplicate addresses`);

    // Delete the duplicates
    let deletedCount = 0;
    if (addressesToDelete.length > 0) {
      const deletePromises = addressesToDelete.map(id => 
        prisma.houseAddress.delete({ where: { id } })
      );
      await Promise.all(deletePromises);
      deletedCount = addressesToDelete.length;
    }

    console.log(`Cleanup complete! Deleted ${deletedCount} duplicate addresses.`);

    // Get final count
    const finalAddresses = await prisma.houseAddress.count();

    return NextResponse.json({
      success: true,
      deleted: deletedCount,
      kept: addressesToKeep.size,
      finalCount: finalAddresses,
      message: `Deleted ${deletedCount} duplicate addresses. ${finalAddresses} addresses remaining.`
    });

  } catch (error: any) {
    console.error("Cleanup error:", error);
    return NextResponse.json({ 
      success: false, 
      error: error.message 
    }, { status: 500 });
  }
}
