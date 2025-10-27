import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export async function GET(request: NextRequest) {
  try {
    // Get all addresses from HouseAddress table
    const allAddresses = await prisma.houseAddress.findMany({
      orderBy: {
        updatedAt: 'desc' // Order by updatedAt to see most recently modified
      },
      take: 20 // Get the 20 most recent
    });
    
    console.log("Debug: All addresses:", allAddresses);
    
    // Get user count
    const userCount = await prisma.user.count();
    
    // Get HouseAddress count
    const addressCount = await prisma.houseAddress.count();
    
    return NextResponse.json({ 
      success: true,
      totalUsers: userCount,
      totalAddresses: addressCount,
      recentAddresses: allAddresses,
      message: `Found ${addressCount} addresses`
    });
    
  } catch (error: any) {
    console.error("Debug: List addresses failed:", error);
    return NextResponse.json({ 
      success: false, 
      error: error.message
    }, { status: 500 });
  }
}
