import { Prisma } from '@prisma/client';
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';

export const dynamic = 'force-dynamic';

function isTestimonialTableMissing(error: unknown) {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === 'P2021' &&
    /TestimonialSubmission/i.test(error.message)
  );
}

export async function GET() {
  try {
    const now = new Date();
    const prismaAny = prisma as any;

    const [
      totalUsers,
      activeSmtAuthorizations,
      activeManualUploads,
      applianceCount,
      pendingSmtRevocations,
      smtUserResults,
      manualUserResults,
      referralPendingCountBase,
      referralQualifiedCountBase,
      pendingSmtEmailConfirmations,
      declinedSmtEmailConfirmations,
      approvedSmtEmailConfirmations,
    ] = await Promise.all([
      prisma.user.count(),
      prisma.smtAuthorization.count({
        where: { archivedAt: null },
      }),
      prismaAny.manualUsageUpload.count({
        where: { expiresAt: { gte: now } },
      }),
      prismaAny.appliance.count(),
      prisma.userProfile.count({
        where: {
          esiidAttentionRequired: true,
          esiidAttentionCode: 'smt_revoke_requested',
        },
      }),
      prisma.smtAuthorization.findMany({
        where: { archivedAt: null },
        select: { userId: true },
        distinct: ['userId'],
      }),
      prismaAny.manualUsageUpload.findMany({
        where: { expiresAt: { gte: now } },
        select: { userId: true },
        distinct: ['userId'],
      }),
      prismaAny.referral.count({
        where: { status: 'PENDING' },
      }),
      prismaAny.referral.count({
        where: { status: 'QUALIFIED' },
      }),
      prismaAny.smtAuthorization.count({
        where: {
          archivedAt: null,
          emailConfirmationStatus: 'PENDING',
        },
      }),
      prismaAny.smtAuthorization.count({
        where: {
          archivedAt: null,
          emailConfirmationStatus: 'DECLINED',
        },
      }),
      prismaAny.smtAuthorization.count({
        where: {
          archivedAt: null,
          emailConfirmationStatus: 'APPROVED',
        },
      }),
    ]);

    const usageUserSet = new Set<string>();
    for (const record of smtUserResults) {
      usageUserSet.add(record.userId);
    }
    for (const record of manualUserResults) {
      usageUserSet.add(record.userId);
    }

    let totalTestimonials = 0;
    let pendingTestimonials = 0;
    let referralPendingCount = referralPendingCountBase;
    let referralQualifiedCount = referralQualifiedCountBase;

    try {
      totalTestimonials = await prismaAny.testimonialSubmission.count();
      pendingTestimonials = await prismaAny.testimonialSubmission.count({
        where: { status: 'PENDING' },
      });
    } catch (error) {
      if (!isTestimonialTableMissing(error)) {
        throw error;
      }
      if (process.env.NODE_ENV !== 'production') {
        console.warn('[admin stats] Testimonial table missing; counters defaulting to zero.');
      }
    }

    return NextResponse.json({
      totalUsers,
      activeSmtAuthorizations,
      activeManualUploads,
      activeHouseCount: 0,
      applianceCount,
      pendingSmtRevocations,
      totalUsageCustomers: usageUserSet.size,
      testimonialSubmissionCount: totalTestimonials,
      testimonialPendingCount: pendingTestimonials,
      referralPendingCount,
      referralQualifiedCount,
      pendingSmtEmailConfirmations,
      declinedSmtEmailConfirmations,
      approvedSmtEmailConfirmations,
    });
  } catch (error) {
    console.error('Error fetching admin summary stats:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}


