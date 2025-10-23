import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { db } from '@/lib/db';

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const token = searchParams.get('token');

  if (!token) {
    return new Response('Missing token', { status: 400 });
  }

  const record = await db.magicLinkToken.findUnique({
    where: { token },
  });

  if (!record || record.used || new Date() > record.expiresAt) {
    return new Response('Invalid or expired token', { status: 401 });
  }

  const cookieStore = cookies();
  const referrerCode = cookieStore.get('referrer')?.value;

  // Find user (or create if new)
  let user = await db.user.findUnique({
    where: { email: record.email },
  });

  if (!user) {
    let referredByUser = null;

    if (referrerCode) {
      referredByUser = await db.user.findUnique({
        where: { referralCode: referrerCode },
      });
    }

    user = await db.user.create({
      data: {
        email: record.email,
        entryCount: referredByUser ? 2 : 1, // 1 default + 1 bonus
        referredById: referredByUser?.id ?? undefined,
      },
    });

    // If referral was valid, update inviter's stats
    if (referredByUser) {
      await db.user.update({
        where: { id: referredByUser.id },
        data: {
          referralCount: { increment: 1 },
          entryCount: { increment: 5 },
        },
      });
    }
  }

  // Mark token as used
  await db.magicLinkToken.update({
    where: { token },
    data: { used: true },
  });

  // Set login cookie
  cookies().set({
    name: 'intelliwatt_user',
    value: user.email,
    httpOnly: true,
    secure: true,
    path: '/',
    maxAge: 60 * 60 * 24 * 7,
  });

  // Clear referrer cookie after use
  cookies().set({
    name: 'referrer',
    value: '',
    expires: new Date(0),
    path: '/',
  });

  redirect('/dashboard');
} 