import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

/**
 * GET /api/ping.txt
 * Plain-text ping endpoint - no authentication required
 * Returns: "OK"
 */
export async function GET() {
  return new NextResponse('OK', {
    status: 200,
    headers: {
      'Content-Type': 'text/plain',
    },
  });
}

