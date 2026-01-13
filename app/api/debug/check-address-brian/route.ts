import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { normalizeEmail } from '@/lib/utils/email';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const emailRaw = String(searchParams.get("email") ?? "brian@intellipath-solutions.com").trim();
    // Normalize email to lowercase for consistent lookup
    const email = normalizeEmail(emailRaw);
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
            id: true,
            email: true,
            createdAt: true
          }
        }
      }
    });
    
    console.log("Debug: UserProfile data:", userProfile);
    
    // Check if user exists
    const user = await prisma.user.findUnique({
      where: { email: email },
      select: {
        id: true,
        email: true,
        createdAt: true,
        profile: true
      }
    });
    
    console.log("Debug: User data:", user);

    // Check HouseAddress table (current system)
    const houseAddresses = await prisma.houseAddress.findMany({
      where: {
        OR: [
          ...(user?.id ? [{ userId: user.id }] : []),
          { userEmail: email },
        ],
      },
      orderBy: { updatedAt: "desc" },
    });
    
    console.log("Debug: HouseAddress data:", houseAddresses);
    
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
