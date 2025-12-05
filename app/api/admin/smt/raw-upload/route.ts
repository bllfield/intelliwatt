import { NextRequest, NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db';
import { requireAdmin } from '@/lib/auth/admin';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const gate = requireAdmin(req);
  if (!gate.ok) return NextResponse.json(gate.body, { status: gate.status });

  const body = await req.json().catch(() => ({} as Record<string, unknown>));
  const filename = body.filename as string | undefined;
  const sizeBytes = (body.sizeBytes ?? body.size_bytes) as number | undefined;
  const sha256 = body.sha256 as string | undefined;
  const receivedAt = (body.receivedAt ?? body.received_at) as string | undefined;
  const source = (body.source as string | undefined) ?? 'adhocusage';
  const contentType =
    (body.contentType as string | undefined) ??
    (body.content_type as string | undefined) ??
    'application/octet-stream';
  const storagePath =
    (body.storagePath as string | undefined) ??
    (body.storage_path as string | undefined) ??
    `/adhocusage/${filename ?? ''}`;
  // STEP 1: Accept optional contentBase64 for large-file SMT ingestion path
  const contentBase64 = body.contentBase64 as string | undefined;

  const missing: string[] = [];

  if (!filename) missing.push('filename (string)');
  if (typeof sizeBytes !== 'number' || Number.isNaN(sizeBytes)) {
    missing.push('size_bytes|sizeBytes (number)');
  }
  if (!sha256) missing.push('sha256 (string)');
  // NOTE: contentBase64 is optional for backward compatibility with old callers

  if (missing.length > 0) {
    const receivedKeys = Object.keys(body ?? {});
    console.error('[raw-upload] validation failed', { missing, receivedKeys });
    return NextResponse.json(
      {
        ok: false,
        error: 'VALIDATION',
        details: 'Missing or invalid required fields',
        missing,
        receivedKeys,
      },
      { status: 400 },
    );
  }

  // Log whether contentBase64 was provided (for SMT large-file ingestion debugging)
  if (contentBase64) {
    console.log('[raw-upload] contentBase64 provided, length:', contentBase64.length);
  } else {
    console.log('[raw-upload] no contentBase64 (legacy path or S3 storage)');
  }

  try {
    // Idempotency: if a row with this sha256 already exists, return it instead of failing
    const existing = await prisma.rawSmtFile.findUnique({
      where: { sha256 }, // requires a UNIQUE on sha256 (which you added)
      select: { id: true, filename: true, size_bytes: true, sha256: true, created_at: true },
    });

    if (existing) {
      return NextResponse.json({
        ok: true,
        duplicate: true,
        id: String(existing.id), // BigInt -> string
        filename: existing.filename,
        sizeBytes: existing.size_bytes,
        sha256: existing.sha256,
        createdAt: existing.created_at, // Date serializes fine
      });
    }

    // Create new record
    // STEP 1: Store contentBase64 as Buffer if provided (RawSmtFile.content is Bytes type)
    const contentBuffer = contentBase64 ? Buffer.from(contentBase64, 'base64') : undefined;
    
    const row = await prisma.rawSmtFile.create({
      data: {
        filename: filename!,
        size_bytes: sizeBytes!,
        sha256: sha256!,
        source,
        content_type: contentType,
        storage_path: storagePath,
        content: contentBuffer,
        received_at: receivedAt ? new Date(receivedAt) : new Date(),
      },
      select: { id: true, filename: true, size_bytes: true, sha256: true, created_at: true },
    });

    return NextResponse.json({
      ok: true,
      id: String(row.id), // BigInt -> string
      filename: row.filename,
      sizeBytes: row.size_bytes,
      sha256: row.sha256,
      createdAt: row.created_at,
    });
  } catch (e: any) {
    // Safety net: if we still hit a P2002 (unique constraint), treat as idempotent
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002' && sha256) {
      try {
        const existing = await prisma.rawSmtFile.findUnique({
          where: { sha256 },
          select: { id: true, filename: true, size_bytes: true, sha256: true, created_at: true },
        });
        if (existing) {
          return NextResponse.json({
            ok: true,
            duplicate: true,
            id: String(existing.id),
            filename: existing.filename,
            sizeBytes: existing.size_bytes,
            sha256: existing.sha256,
            createdAt: existing.created_at,
          });
        }
      } catch (lookupError) {
        // If lookup fails, fall through to generic error
        console.error('[raw-upload] P2002 but lookup failed', lookupError);
      }
    }

    // Safe error serialization - avoid BigInt issues
    const errorDetails = e?.message || e?.toString() || 'Unknown database error';
    return NextResponse.json(
      { ok: false, error: 'DB', details: errorDetails },
      { status: 500 },
    );
  }
}
