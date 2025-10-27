import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export async function GET(request: NextRequest) {
  try {
    // Get all addresses from HouseAddress table
    const allAddresses = await prisma.houseAddress.findMany({
      orderBy: {
        createdAt: 'desc'
      },
      take: 10 // Get the 10 most recent
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
