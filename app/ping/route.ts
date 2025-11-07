import { NextResponse } from 'next/server';

export async function GET() {
  return NextResponse.json({
    ok: true,
    service: 'intelliwatt',
    ts: new Date().toISOString(),
    path: '/ping',
  });
}
