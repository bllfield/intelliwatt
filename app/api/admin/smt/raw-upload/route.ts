import { NextRequest, NextResponse } from 'next/server';
import { saveRawSmtFile } from '@/lib/smt/saveRawSmtFile';
import { requireAdmin } from '@/lib/auth/admin';

export async function POST(req: NextRequest) {
  const gate = requireAdmin(req);
  if (!gate.ok) return NextResponse.json(gate.body, { status: gate.status });

  const body = await req.json().catch(() => ({} as Record<string, unknown>));
  const filename = body.filename as string | undefined;
  const sizeBytes = (body.sizeBytes ?? body.size_bytes) as number | undefined;
  const sha256 = body.sha256 as string | undefined;
  const storagePath =
    (body.storagePath as string | undefined) ??
    (body.storage_path as string | undefined) ??
    `/adhocusage/${filename ?? ''}`;

  const missing: string[] = [];

  if (!filename) missing.push('filename (string)');
  if (typeof sizeBytes !== 'number' || Number.isNaN(sizeBytes)) {
    missing.push('size_bytes|sizeBytes (number)');
  }
  if (!sha256) missing.push('sha256 (string)');

  if (missing.length > 0) {
    const receivedKeys = Object.keys(body ?? {});
    // helpful server log (keeps corrId flow you already have)
    console.error('[raw-upload] validation failed', { missing, receivedKeys, body });
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

  try {
    // Use existing saveRawSmtFile function which handles idempotency
    // For metadata-only uploads, use empty buffer
    // TypeScript: these are guaranteed to be defined after validation
    const result = await saveRawSmtFile({
      filename: filename!,
      size: sizeBytes!,
      sha256: sha256!,
      sourcePath: storagePath,
      content: Buffer.alloc(0), // Empty buffer for metadata-only uploads
    });

    return NextResponse.json({
      ok: true,
      id: result.id,
      filename,
      sizeBytes,
      sha256: result.sha256,
      created: result.created,
    });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: 'DB', details: String(error) },
      { status: 500 },
    );
  }
}
