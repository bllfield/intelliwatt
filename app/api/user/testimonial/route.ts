import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db';
import { normalizeEmail } from '@/lib/utils/email';
import { refreshUserEntryStatuses } from '@/lib/hitthejackwatt/entryLifecycle';

export const dynamic = 'force-dynamic';

const COMMISSION_STATUS_ALLOWLIST = ['pending', 'submitted', 'approved', 'completed', 'paid'];
const TESTIMONIAL_STATUS_REJECTED = 'REJECTED';
const TESTIMONIAL_STATUS_PENDING = 'PENDING';

function isTestimonialTableMissing(error: unknown) {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === 'P2021' &&
    /TestimonialSubmission/i.test(error.message)
  );
}

function sanitizeContent(value: unknown): string {
  if (typeof value !== 'string') {
    return '';
  }
  return value.trim();
}

export async function POST(request: NextRequest) {
  try {
    const cookieStore = cookies();
    const userEmailRaw = cookieStore.get('intelliwatt_user')?.value ?? null;

    if (!userEmailRaw) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    }

    const userEmail = normalizeEmail(userEmailRaw);

    const body = await request.json().catch(() => ({}));
    const contentRaw = body?.content ?? '';
    const content = sanitizeContent(contentRaw);

    if (content.length < 40) {
      return NextResponse.json(
        { error: 'Please share at least 40 characters about your experience.' },
        { status: 400 },
      );
    }

    if (content.length > 1500) {
      return NextResponse.json(
        { error: 'Testimonials may be up to 1,500 characters.' },
        { status: 400 },
      );
    }

    const user = await prisma.user.findUnique({
      where: { email: userEmail },
      select: { id: true },
    });

    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    const prismaAny = prisma as any;

    const qualifyingCommission = await prisma.commissionRecord.findFirst({
      where: {
        userId: user.id,
        status: { in: COMMISSION_STATUS_ALLOWLIST },
        OR: [
          { type: { contains: 'switch', mode: 'insensitive' } },
          { type: { contains: 'plan', mode: 'insensitive' } },
          { type: { contains: 'upgrade', mode: 'insensitive' } },
        ],
      },
      select: { id: true },
    });

    if (!qualifyingCommission) {
      return NextResponse.json(
        {
          error:
            'Testimonials unlock after you switch plans or complete an upgrade through IntelliWatt. Reach out to support if this feels incorrect.',
        },
        { status: 403 },
      );
    }

    let existingSubmission: {
      id: string;
      status: string;
    } | null = null;

    try {
      existingSubmission = await prismaAny.testimonialSubmission.findFirst({
        where: { userId: user.id },
        orderBy: { submittedAt: 'desc' },
      });
    } catch (error) {
      if (isTestimonialTableMissing(error)) {
        return NextResponse.json(
          {
            error:
              'Testimonials are not enabled yet. Please contact an administrator to run the latest database migration.',
          },
          { status: 503 },
        );
      }
      throw error;
    }

    if (existingSubmission && existingSubmission.status !== TESTIMONIAL_STATUS_REJECTED) {
      return NextResponse.json(
        { error: 'You already submitted a testimonial. Reach out to support if you need to update it.' },
        { status: 409 },
      );
    }

    const now = new Date();

    const result = await prisma.$transaction(async (txBase) => {
      const tx = txBase as any;
      let submission =
        existingSubmission && existingSubmission.status === TESTIMONIAL_STATUS_REJECTED
          ? await tx.testimonialSubmission.update({
              where: { id: existingSubmission.id },
              data: {
                content,
                status: TESTIMONIAL_STATUS_PENDING,
                submittedAt: now,
                source: 'profile',
              },
            })
          : await tx.testimonialSubmission.create({
              data: {
                userId: user.id,
                content,
                source: 'profile',
              },
            });

      let entryAwarded = false;

      const existingEntry = await tx.entry.findFirst({
        where: {
          userId: user.id,
          type: 'testimonial',
        },
      });

      if (!existingEntry) {
        await tx.entry.create({
          data: {
            userId: user.id,
            type: 'testimonial',
            amount: 1,
            lastValidated: now,
          } as any,
        });
        entryAwarded = true;
      } else if (existingEntry.amount < 1) {
        await tx.entry.update({
          where: { id: existingEntry.id },
          data: {
            amount: 1,
            lastValidated: now,
          } as any,
        });
        entryAwarded = true;
      }

      if (entryAwarded || (!submission.entryAwardedAt && existingEntry)) {
        submission = await tx.testimonialSubmission.update({
          where: { id: submission.id },
          data: {
            entryAwardedAt: submission.entryAwardedAt ?? now,
          },
        });
      }

      return { submission, entryAwarded: entryAwarded || Boolean(existingEntry) };
    });

    await refreshUserEntryStatuses(user.id);

    return NextResponse.json({
      message: 'Testimonial submitted',
      submission: {
        id: result.submission.id,
        status: result.submission.status,
        content: result.submission.content,
        submittedAt: result.submission.submittedAt.toISOString(),
        entryAwardedAt: result.submission.entryAwardedAt
          ? result.submission.entryAwardedAt.toISOString()
          : null,
      },
      entryAwarded: result.entryAwarded,
    });
  } catch (error) {
    console.error('Error submitting testimonial:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

