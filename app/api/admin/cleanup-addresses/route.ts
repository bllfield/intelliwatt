import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { prisma } from "@/lib/db";

export async function POST(request: NextRequest) {
  try {
    // Check admin authentication
    const cookieStore = cookies();
    const adminEmail = cookieStore.get('intelliwatt_admin')?.value;
    
    if (adminEmail !== 'brian@intellipath-solutions.com') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const result = await cleanupDuplicateAddresses();
    
    return NextResponse.json({
      success: true,
      result,
      message: 'Address cleanup completed successfully'
    });
    
  } catch (error: any) {
    console.error("Cleanup error:", error);
    return NextResponse.json({ 
      success: false, 
      error: error.message 
    }, { status: 500 });
  }
}

async function cleanupDuplicateAddresses() {
  // Get all users who have addresses
  const allAddresses = await prisma.houseAddress.findMany({
    orderBy: { updatedAt: 'desc' }
  });
  
  // Group by userId and keep only the most recent for each user
  const addressesToKeep = new Map<string, string>();
  const addressesToDelete: string[] = [];
  
  for (const address of allAddresses) {
    const existing = addressesToKeep.get(address.userId);
    if (!existing) {
      // Keep this one (most recent for this user)
      addressesToKeep.set(address.userId, address.id);
    } else {
      // Mark for deletion
      addressesToDelete.push(address.id);
    }
  }
  
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
  
  return {
    kept: addressesToKeep.size,
    deleted: deletedCount,
    addressesToKeep: Array.from(addressesToKeep.entries()).map(([userId, addressId]) => ({
      userId,
      addressId
    }))
  };
}
