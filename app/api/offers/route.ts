import { NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  return NextResponse.json(
    {
      ok: false,
      error: 'OFFERS_DEPRECATED',
      message: 'This endpoint is retired. Use admin routes /api/admin/wattbuy/retail-rates and /api/admin/wattbuy/electricity.',
    },
    { status: 410 }
  );
}
