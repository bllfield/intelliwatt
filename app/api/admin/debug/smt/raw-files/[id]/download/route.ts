import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requireAdmin } from '@/lib/auth/admin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function parseId(idParam: string | string[] | undefined): bigint | null {
  if (!idParam) return null;
  const raw = Array.isArray(idParam) ? idParam[0] : idParam;
  if (!raw) return null;
  try {
    const num = BigInt(raw);
    if (num < BigInt(0)) return null;
    return num;
  } catch {
    return null;
  }
}

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const gate = requireAdmin(req);
  if (!gate.ok) return NextResponse.json(gate.body, { status: gate.status });

  const id = parseId(params?.id);
  if (id == null) {
    return NextResponse.json(
      { ok: false, error: 'INVALID_ID', message: 'Provide numeric raw SMT file id' },
      { status: 400 }
    );
  }

  const row = await prisma.rawSmtFile.findUnique({ where: { id } });
  if (!row) {
    return NextResponse.json(
      { ok: false, error: 'NOT_FOUND', message: 'SMT raw file not found' },
      { status: 404 }
    );
  }

  if (!row.content || row.content.length === 0) {
    return NextResponse.json(
      {
        ok: false,
        error: 'NO_CONTENT',
        message: 'Raw SMT file has no inline content (likely stored externally).',
      },
      { status: 404 }
    );
  }

  const filename = row.filename || `raw-smt-${row.id}.csv`;
  const contentType = row.content_type || 'application/octet-stream';
  const body = row.content instanceof Buffer ? row.content : Buffer.from(row.content);

  return new Response(body, {
    status: 200,
    headers: {
      'content-type': contentType,
      'content-disposition': `attachment; filename="${filename.replace(/"/g, '')}"`,
      'x-raw-smt-id': row.id.toString(),
    },
  });
}
