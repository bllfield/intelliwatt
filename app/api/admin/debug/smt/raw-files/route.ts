import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requireAdmin } from '@/lib/auth/admin';

export async function GET(req: NextRequest) {
  const gate = requireAdmin(req);
  if (!gate.ok) return NextResponse.json(gate.body, { status: gate.status });

  const { searchParams } = new URL(req.url);
  const limit = Math.min(Math.max(Number(searchParams.get('limit') ?? 5), 1), 50);

  const rows = await prisma.rawSmtFile.findMany({
    orderBy: { created_at: 'desc' },
    take: limit,
    select: {
      id: true,
      filename: true,
      size_bytes: true,
      sha256: true,
      created_at: true,
      storage_path: true,
      source: true,
      content_type: true,
      received_at: true,
    },
  });

  return NextResponse.json({ rows });
}

