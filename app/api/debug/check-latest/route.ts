import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export async function GET(request: NextRequest) {
  try {
    // Get the most recently updated address
    const latest = await prisma.houseAddress.findFirst({
      orderBy: { updatedAt: 'desc' },
      include: {
        user: {
          select: {
            email: true
          }
        }
      }
    });

    // Also get all addresses for bllfield@yahoo.com
    const allForUser = await prisma.houseAddress.findMany({
      where: { userId: 'bllfield@yahoo.com' },
      orderBy: { updatedAt: 'desc' }
    });

    return NextResponse.json({
      success: true,
      latestAddress: latest,
      allForUser: allForUser,
      count: await prisma.houseAddress.count()
    });
  } catch (error: any) {
    return NextResponse.json({
      success: false,
      error: error.message,
      stack: error.stack
    }, { status: 500 });
  }
}

