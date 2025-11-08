import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { db } from '@/lib/db';
import { normalizeEmail } from '@/lib/utils/email';

export const dynamic = 'force-dynamic';

// GET user's entries
export async function GET(request: NextRequest) {
  try {
    const cookieStore = cookies();
    const userEmailRaw = cookieStore.get('intelliwatt_user')?.value;
    
    if (!userEmailRaw) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    }

    // Normalize email to lowercase for consistent lookup
    const userEmail = normalizeEmail(userEmailRaw);

    const user = await db.user.findUnique({
      where: { email: userEmail },
      include: {
        entries: {
          orderBy: { createdAt: 'desc' },
        },
      },
    });

    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    const total = user.entries.reduce((sum, entry) => sum + entry.amount, 0);

    return NextResponse.json({
      entries: user.entries.map(e => ({
        id: e.id,
        type: e.type,
        amount: e.amount,
        createdAt: e.createdAt.toISOString(),
      })),
      total,
    });
  } catch (error) {
    console.error('Error fetching entries:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

// POST - Award entries (called internally when actions complete)
export async function POST(request: NextRequest) {
  try {
    const cookieStore = cookies();
    const userEmailRaw = cookieStore.get('intelliwatt_user')?.value;
    
    if (!userEmailRaw) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    }

    // Normalize email to lowercase for consistent lookup
    const userEmail = normalizeEmail(userEmailRaw);

    const body = await request.json();
    const { type, amount } = body;

    if (!type || typeof amount !== 'number') {
      return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
    }

    const user = await db.user.findUnique({
      where: { email: userEmail },
    });

    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    // Check if entry already exists for this type (if it's a one-time entry)
    const existing = await db.entry.findFirst({
      where: {
        userId: user.id,
        type: type,
      },
    });

    if (existing) {
      return NextResponse.json({
        message: 'Entry already awarded',
        entry: {
          id: existing.id,
          type: existing.type,
          amount: existing.amount,
        },
      });
    }

    // Create entry
    const entry = await db.entry.create({
      data: {
        userId: user.id,
        type: type,
        amount: amount,
      },
    });

    return NextResponse.json({
      message: 'Entry awarded',
      entry: {
        id: entry.id,
        type: entry.type,
        amount: entry.amount,
      },
    });
  } catch (error) {
    console.error('Error awarding entry:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

