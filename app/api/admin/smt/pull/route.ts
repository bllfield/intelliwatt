import { NextRequest, NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { requireAdmin } from '@/lib/auth/admin';
import { prisma } from '@/lib/db';
import { saveRawToStorage } from '@/app/lib/storage/rawFiles';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const WEBHOOK_HEADERS = ['x-intelliwatt-secret', 'x-smt-secret', 'x-webhook-secret'] as const;

type WebhookAuthResult =
  | { matched: true; reason: 'MATCHED'; header: string }
  | { matched: false; reason: 'SECRET_NOT_CONFIGURED' | 'HEADER_MISSING' };

function usingWebhookSecret(req: NextRequest): WebhookAuthResult {
  const secret = (process.env.INTELLIWATT_WEBHOOK_SECRET ?? process.env.DROPLET_WEBHOOK_SECRET ?? '').trim();
  if (!secret) return { matched: false, reason: 'SECRET_NOT_CONFIGURED' };
  for (const headerName of WEBHOOK_HEADERS) {
    const value = (req.headers.get(headerName) ?? '').trim();
    if (value && value === secret) {
      return { matched: true, reason: 'MATCHED', header: headerName };
    }
  }
  return { matched: false, reason: 'HEADER_MISSING' };
}

/**
 * POST /api/admin/smt/pull
 *
 * Trigger SMT pull for a given ESIID via webhook, or persist inline uploads for diagnostics.
 * Accepts either x-admin-token (interactive) or x-intelliwatt-secret (droplet webhook).
 */
export async function POST(req: NextRequest) {
  const secretCheck = usingWebhookSecret(req);
  const hasWebhookAuth = secretCheck.matched;

  if (!hasWebhookAuth) {
    const gate = requireAdmin(req);
    if (!gate.ok) {
      return NextResponse.json(gate.body, { status: gate.status });
    }
  }

  const contentType = req.headers.get('content-type') || '';
  if (!contentType.toLowerCase().includes('application/json')) {
    return NextResponse.json({ ok: false, error: 'EXPECTED_JSON' }, { status: 400 });
  }

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'BAD_JSON' }, { status: 400 });
  }

  if (body?.mode === 'inline') {
    const {
      source: rawSource = 'adhocusage',
      filename: rawFilename = 'adhoc.csv',
      mime = 'text/csv',
      encoding = 'base64',
      content_b64,
      esiid,
      meter,
      captured_at,
      sizeBytes: declaredSize,
    } = body ?? {};

    if (!content_b64 || encoding !== 'base64') {
      return NextResponse.json({ ok: false, error: 'INLINE_MISSING_B64' }, { status: 400 });
    }

    let filename = typeof rawFilename === 'string' ? rawFilename.trim() : '';
    filename = filename.replace(/^[\\/]+/, '');
    if (!filename) {
      return NextResponse.json({ ok: false, error: 'INLINE_MISSING_FILENAME' }, { status: 400 });
    }

    let source = typeof rawSource === 'string' ? rawSource.trim() : 'adhocusage';
    source = source || 'adhocusage';

    try {
      const buf = Buffer.from(content_b64, 'base64');
      const computedSize = buf.byteLength;
      if (declaredSize && Number(declaredSize) !== computedSize) {
        return NextResponse.json(
          {
            ok: false,
            error: 'INLINE_SIZE_MISMATCH',
            expected: Number(declaredSize),
            actual: computedSize,
          },
          { status: 400 },
        );
      }

      let saved;
      try {
        saved = await saveRawToStorage({ source, filename, mime, buf });
      } catch (storageError: any) {
        console.error('[smt/pull:inline] storage failed', storageError);
        return NextResponse.json(
          { ok: false, error: 'STORAGE_FAILED', detail: String(storageError?.message ?? storageError) },
          { status: 500 },
        );
      }

      const receivedAt = captured_at ? new Date(captured_at) : new Date();
      const safeReceivedAt = Number.isNaN(receivedAt.getTime()) ? new Date() : receivedAt;

      let recordId: bigint | null = null;
      let duplicate = false;
      try {
        const created = await prisma.rawSmtFile.create({
          data: {
            filename: saved.filename,
            size_bytes: saved.sizeBytes,
            sha256: saved.sha256,
            source: saved.source,
            content_type: saved.contentType,
            storage_path: saved.storagePath,
            content: buf,
            received_at: safeReceivedAt,
          },
          select: { id: true },
        });
        recordId = created.id;
      } catch (err: any) {
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
          const existing = await prisma.rawSmtFile.findUnique({
            where: { sha256: saved.sha256 },
            select: { id: true },
          });
          if (existing) {
            recordId = existing.id;
            duplicate = true;
          } else {
            throw err;
          }
        } else {
          throw err;
        }
      }

      return NextResponse.json({
        ok: true,
        mode: 'inline',
        filename: saved.filename,
        mime: saved.contentType,
        source: saved.source,
        esiid,
        meter,
        captured_at,
        sizeBytes: saved.sizeBytes,
        sha256: saved.sha256,
        storagePath: saved.storagePath,
        persisted: !duplicate,
        duplicate,
        id: recordId ? recordId.toString() : undefined,
        message: duplicate
          ? 'Inline payload verified (duplicate sha256, existing record reused).'
          : 'Inline payload stored and verified.',
      });
    } catch (err: any) {
      console.error('[smt/pull:inline] persistence failed', err);
      return NextResponse.json({ ok: false, error: 'INLINE_PERSIST_FAILED', detail: String(err?.message ?? err) }, { status: 500 });
    }
  }

  try {
    const { esiid, meter } = body || {};

    if (!esiid) {
      return NextResponse.json(
        { ok: false, error: 'MISSING_ESIID', details: 'esiid is required' },
        { status: 400 },
      );
    }

    const WEBHOOK_SECRET = (process.env.INTELLIWATT_WEBHOOK_SECRET ?? process.env.DROPLET_WEBHOOK_SECRET ?? '').trim();
    if (!WEBHOOK_SECRET) {
      console.error('SMT webhook missing INTELLIWATT_WEBHOOK_SECRET/DROPLET_WEBHOOK_SECRET');
      return NextResponse.json(
        { ok: false, error: 'SERVER_MISCONFIG', details: 'Missing INTELLIWATT_WEBHOOK_SECRET/DROPLET_WEBHOOK_SECRET' },
        { status: 500 },
      );
    }

    const DROPLET_WEBHOOK_URL = process.env.DROPLET_WEBHOOK_URL;
    if (!DROPLET_WEBHOOK_URL) {
      console.error('SMT webhook missing DROPLET_WEBHOOK_URL');
      return NextResponse.json(
        { ok: false, error: 'SERVER_MISCONFIG', details: 'Missing DROPLET_WEBHOOK_URL' },
        { status: 500 },
      );
    }

    let webhookResponse: Response;
    try {
      webhookResponse = await fetch(DROPLET_WEBHOOK_URL, {
        method: 'POST',
        headers: {
          [WEBHOOK_HEADERS[0]]: WEBHOOK_SECRET,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          reason: 'admin_triggered',
          esiid,
          meter: meter || undefined,
          ts: Date.now(),
        }),
        cache: 'no-store',
      });
    } catch (err: any) {
      return NextResponse.json(
        {
          ok: false,
          error: 'WEBHOOK_CONNECTION_FAILED',
          details: err?.message || 'Failed to connect to webhook',
        },
        { status: 502 },
      );
    }

    if (!webhookResponse.ok) {
      const errorText = await webhookResponse.text().catch(() => 'Unknown error');
      return NextResponse.json(
        {
          ok: false,
          error: 'WEBHOOK_FAILED',
          details: errorText,
          status: webhookResponse.status,
        },
        { status: 502 },
      );
    }

    const webhookData = await webhookResponse.json().catch(() => ({}));

    return NextResponse.json({
      ok: true,
      message: 'SMT pull triggered successfully',
      esiid,
      meter: meter || null,
      webhookResponse: webhookData,
    });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message || 'Failed to trigger SMT pull' },
      { status: 500 },
    );
  }
}

