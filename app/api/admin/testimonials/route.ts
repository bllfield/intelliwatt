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
    const prismaAny = prisma as any;
    let testimonials: Array<{
      id: string;
      status: string;
      content: string;
      submittedAt: Date;
      entryAwardedAt: Date | null;
      user: {
        id: string;
        email: string;
        createdAt: Date;
      };
    }> = [];

    try {
      testimonials = await prismaAny.testimonialSubmission.findMany({
        orderBy: { submittedAt: 'desc' },
        include: {
          user: {
            select: {
              id: true,
              email: true,
              createdAt: true,
            },
          },
        },
      });
    } catch (error) {
      if (!isTestimonialTableMissing(error)) {
        throw error;
      }
      if (process.env.NODE_ENV !== 'production') {
        console.warn('[admin testimonials] Table missing; returning empty list.');
      }
      testimonials = [];
    }

    return NextResponse.json(
      testimonials.map((submission) => ({
        id: submission.id,
        status: submission.status,
        content: submission.content,
        submittedAt: submission.submittedAt.toISOString(),
        entryAwardedAt: submission.entryAwardedAt ? submission.entryAwardedAt.toISOString() : null,
        user: {
          id: submission.user.id,
          email: submission.user.email,
          createdAt: submission.user.createdAt.toISOString(),
        },
      })),
    );
  } catch (error) {
    console.error('Error fetching testimonials:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

