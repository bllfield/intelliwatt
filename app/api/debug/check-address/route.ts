import { NextRequest, NextResponse } from "next/server";
import { guardAdmin } from '@/lib/auth/admin';
import { prisma } from "@/lib/db";
import { normalizeEmail } from '@/lib/utils/email';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const gate = guardAdmin(request);
  if (gate) return gate;
  
  try {
    const { searchParams } = new URL(request.url);
    const emailRaw = String(searchParams.get("email") ?? "").trim();

    if (!emailRaw) {
      return NextResponse.json(
        { success: false, error: "missing_email", details: "Provide ?email=<user email>" },
        { status: 400 },
      );
    }

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
    // HouseAddress.userId is a user CUID; HouseAddress.userEmail is mirrored for ops/debug.
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
