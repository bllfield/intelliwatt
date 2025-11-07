import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { db } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    // Get user email from cookie
    const cookieStore = cookies();
    const userEmail = cookieStore.get('intelliwatt_user')?.value;
    
    if (!userEmail) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    }

    // Find user and their data
    const user = await db.user.findUnique({
      where: { email: userEmail },
      include: {
        entries: true,
        referrals: true,
        profile: {
          include: {
            apiConnections: true
          }
        },
        usage: {
          orderBy: { createdAt: 'desc' },
          take: 1
        },
        utilityPlans: {
          where: { isCurrent: true },
          take: 1
        }
      }
    });

    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    // Query HouseAddress separately since relation may not be defined
    const houseAddress = await db.houseAddress.findFirst({
      where: { userId: user.id },
      orderBy: { updatedAt: 'desc' }
    });

    // Calculate stats
    const totalEntries = user.entries?.length || 0;
    const totalReferrals = user.referrals?.length || 0;
    
    // Calculate annual savings (placeholder - would need real calculation)
    const annualSavings = user.utilityPlans?.[0] ? 0 : 0; // TODO: Calculate based on plan comparison
    
    // Calculate accuracy rate (placeholder)
    const accuracyRate = 0; // TODO: Calculate based on actual data

    const dashboardData = {
      user: {
        id: user.id,
        email: user.email,
        createdAt: user.createdAt
      },
      stats: {
        annualSavings,
        accuracyRate,
        totalEntries,
        totalReferrals
      },
      profile: user.profile,
      address: houseAddress || null,
      hasAddress: !!houseAddress,
      hasSmartMeter: !!user.profile?.apiConnections?.length,
      hasUsageData: !!user.usage?.length,
      currentPlan: user.utilityPlans?.[0] || null
    };

    return NextResponse.json(dashboardData);
  } catch (error) {
    console.error('Error fetching user dashboard data:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
