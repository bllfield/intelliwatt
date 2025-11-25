import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const prismaAny = prisma as any;
    const testimonials = await prismaAny.testimonialSubmission.findMany({
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

    return NextResponse.json(
      testimonials.map((submission: any) => ({
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

