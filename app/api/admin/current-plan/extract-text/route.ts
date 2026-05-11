import { NextRequest, NextResponse } from 'next/server';
import { Buffer } from 'node:buffer';

import { extractBillTextFromUpload } from '@/lib/billing/extractBillText';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  try {
    const adminToken = process.env.ADMIN_TOKEN;
    if (!adminToken) {
      return NextResponse.json(
        { ok: false, error: 'ADMIN_TOKEN not configured' },
        { status: 500 },
      );
    }

    const headerToken = request.headers.get('x-admin-token');
    if (!headerToken || headerToken !== adminToken) {
      return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
    }

    const contentType = request.headers.get('content-type') ?? '';
    if (!contentType.toLowerCase().includes('multipart/form-data')) {
      return NextResponse.json(
        { ok: false, error: 'Content-Type must be multipart/form-data with a file field.' },
        { status: 400 },
      );
    }

    const formData = await request.formData();
    const file = formData.get('file');

    if (!(file instanceof File)) {
      return NextResponse.json(
        { ok: false, error: 'Missing file field in form data.' },
        { status: 400 },
      );
    }

    const lowerName = (file.name ?? '').toLowerCase();
    const lowerType = (file.type ?? '').toLowerCase();
    const isPdf =
      lowerType === 'application/pdf' ||
      lowerName.endsWith('.pdf');

    if (!isPdf) {
      return NextResponse.json(
        {
          ok: false,
          error:
            'PDF is preferred for admin bill text extraction. If your bill is an image or screenshot, open it, copy/paste the visible text instead, and keep the original image for review if any fields are missed.',
        },
        { status: 400 },
      );
    }

    const arrayBuffer = await file.arrayBuffer();
    if (arrayBuffer.byteLength === 0) {
      return NextResponse.json(
        { ok: false, error: 'Uploaded file is empty.' },
        { status: 400 },
      );
    }

    const billBuffer = Buffer.from(arrayBuffer);

    const text = await extractBillTextFromUpload({
      mimeType: file.type,
      filename: file.name,
      billData: billBuffer,
    });

    if (!text || !text.trim()) {
      return NextResponse.json(
        {
          ok: false,
          error:
            'Could not extract text from PDF. Open the bill, copy/paste the visible text instead, and keep the original image for review if anything is missed.',
        },
        { status: 422 },
      );
    }

    return NextResponse.json({
      ok: true,
      text,
    });
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('[admin/current-plan/extract-text] Failed to extract bill text', error);
    return NextResponse.json(
      {
        ok: false,
        error: 'Failed to extract text from uploaded bill.',
      },
      { status: 500 },
    );
  }
}


