import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';

export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  try {
    const email = "brian@intellipath-solutions.com";
    console.log(`Debug: Checking address for ${email}...`);
    
    // Check UserProfile table (old system)
    const userProfile = await prisma.userProfile.findFirst({
      where: {
        user: {
          email: email
        }
      },
      include: {
        user: {
          select: {
            email: true,
            createdAt: true
          }
        }
      }
    });
    
    console.log("Debug: UserProfile data:", userProfile);
    
    // Check HouseAddress table (new system)
    const houseAddresses = await prisma.houseAddress.findMany({
      where: {
        userId: email
      }
    });
    
    console.log("Debug: HouseAddress data:", houseAddresses);
    
    // Check if user exists
    const user = await prisma.user.findUnique({
      where: { email: email },
      select: {
        email: true,
        createdAt: true,
        profile: true
      }
    });
    
    console.log("Debug: User data:", user);
    
    return NextResponse.json({ 
      success: true,
      email: email,
      user: user,
      userProfile: userProfile,
      houseAddresses: houseAddresses,
      message: `Address check complete for ${email}`
    });
    
  } catch (error: any) {
    console.error("Debug: Address check failed:", error);
    return NextResponse.json({ 
      success: false, 
      error: error.message,
      stack: error.stack
    }, { status: 500 });
  }
}
