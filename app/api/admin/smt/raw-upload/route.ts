import { NextRequest, NextResponse } from 'next/server';
import { guardAdmin } from '@/lib/auth/admin';
import { saveRawSmtFile } from '@/lib/smt/saveRawSmtFile';
import crypto from 'crypto';

/**
 * POST /api/admin/smt/raw-upload
 * 
 * Admin-gated endpoint to receive RAW SMT files (per PC-2025-02).
 * 
 * Request body:
 * {
 *   filename: string;
 *   sourcePath?: string;
 *   size: number;
 *   content: string; // base64 encoded
 * }
 * 
 * Response:
 * {
 *   ok: boolean;
 *   fileId: string;
 *   created: boolean;
 *   sha256: string;
 * }
 */
export async function POST(req: NextRequest) {
  // Guard against unauthorized access
  const gate = guardAdmin(req);
  if (gate) return gate;

  try {
    const body = await req.json();

    // Validate required fields
    if (!body.filename || typeof body.filename !== 'string') {
      return NextResponse.json(
        { ok: false, error: 'filename is required and must be a string' },
        { status: 400 }
      );
    }

    if (!body.content || typeof body.content !== 'string') {
      return NextResponse.json(
        { ok: false, error: 'content is required and must be a string (base64)' },
        { status: 400 }
      );
    }

    if (typeof body.size !== 'number' || body.size <= 0) {
      return NextResponse.json(
        { ok: false, error: 'size is required and must be a positive number' },
        { status: 400 }
      );
    }

    // Calculate SHA256 from base64 content
    const sha256 = crypto.createHash('sha256').update(body.content, 'base64').digest('hex');

    // Convert base64 to Buffer
    const contentBuffer = Buffer.from(body.content, 'base64');

    // Save file to database (idempotent via SHA256 unique constraint)
    const result = await saveRawSmtFile({
      filename: body.filename,
      sourcePath: body.sourcePath ?? null,
      size: body.size,
      sha256,
      content: contentBuffer,
    });

    return NextResponse.json({
      ok: true,
      fileId: result.id,
      created: result.created,
      sha256: result.sha256,
    }, { status: 200 });

  } catch (error: any) {
    console.error('[SMT raw upload] Error:', error);
    return NextResponse.json(
      { ok: false, error: error?.message || 'Internal server error' },
      { status: 500 }
    );
  }
}

