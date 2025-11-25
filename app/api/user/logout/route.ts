import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';

export const dynamic = 'force-dynamic';

export async function POST() {
  const cookieStore = cookies();

  cookieStore.set({
    name: 'intelliwatt_user',
    value: '',
    expires: new Date(0),
    path: '/',
  });

  cookieStore.set({
    name: 'intelliwatt_referrer',
    value: '',
    expires: new Date(0),
    path: '/',
  });

  return NextResponse.json({ ok: true });
}


