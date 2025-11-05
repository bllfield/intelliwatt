export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

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
      id: true,            // BigInt
      filename: true,
      size_bytes: true,
      sha256: true,
      created_at: true,    // Date
      received_at: true,   // Date | null
      source: true,
      storage_path: true,
      content_type: true,
    },
  });

  const dto = rows.map(r => ({
    id: String(r.id), // BigInt -> string
    filename: r.filename,
    sizeBytes: r.size_bytes,
    sha256: r.sha256,
    createdAt: r.created_at.toISOString(),
    receivedAt: r.received_at ? r.received_at.toISOString() : null,
    source: r.source ?? null,
    storagePath: r.storage_path ?? null,
    contentType: r.content_type ?? null,
  }));

  return NextResponse.json({ rows: dto });
}


