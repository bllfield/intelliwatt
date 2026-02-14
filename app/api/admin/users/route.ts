import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth/admin';
import { db } from '@/lib/db';
import { normalizeEmailSafe } from '@/lib/utils/email';

export const dynamic = 'force-dynamic';

// Keep consistent with `app/admin/magic/route.ts` + `app/api/send-admin-magic-link/route.ts`
const ADMIN_EMAILS = ['brian@intelliwatt.com', 'brian@intellipath-solutions.com'];

function hasAdminSessionCookie(request: NextRequest): boolean {
  const raw = request.cookies.get('intelliwatt_admin')?.value ?? '';
  const email = normalizeEmailSafe(raw);
  if (!email) return false;
  return ADMIN_EMAILS.includes(email);
}

export async function GET(request: NextRequest) {
  try {
    // Allow either:
    // - a valid admin session cookie (normal admin UI flow), OR
    // - the strict header token gate (useful for scripts / hardening).
    if (!hasAdminSessionCookie(request)) {
      const gate = requireAdmin(request);
      if (!gate.ok) return NextResponse.json(gate.body, { status: gate.status });
    }

    const users = await db.user.findMany({
      include: {
        entries: true,
        referrals: true,
        profile: true,
      },
      orderBy: {
        createdAt: 'desc',
      },
    });

    const userIds = users.map((user) => user.id);

    const houses = userIds.length
      ? await db.houseAddress.findMany({
          where: {
            userId: { in: userIds },
          },
          select: {
            id: true,
            userId: true,
            archivedAt: true,
            addressLine1: true,
          },
          orderBy: {
            createdAt: 'asc',
          },
        })
      : [];

    type HouseSummary = (typeof houses)[number];

    const housesByUser = houses.reduce<Record<string, HouseSummary[]>>((acc, house) => {
      if (!acc[house.userId]) {
        acc[house.userId] = [];
      }
      acc[house.userId].push(house);
      return acc;
    }, {});

    const payload = users.map((user) => ({
      ...user,
      houseAddresses: housesByUser[user.id] ?? [],
    }));

    return NextResponse.json(payload);
  } catch (error) {
    console.error('Error fetching users:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
} 