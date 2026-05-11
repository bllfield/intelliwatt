import { NextRequest, NextResponse } from 'next/server';

import { getCurrentPlanPrisma } from '@/lib/prismaCurrentPlan';

export const dynamic = 'force-dynamic';

export async function GET(
  request: NextRequest,
  context: { params: { id: string } },
) {
  try {
    const adminToken = process.env.ADMIN_TOKEN;
    if (!adminToken) {
      return NextResponse.json({ ok: false, error: 'ADMIN_TOKEN not configured' }, { status: 500 });
    }

    const headerToken = request.headers.get('x-admin-token');
    if (!headerToken || headerToken !== adminToken) {
      return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
    }

    const uploadId = String(context.params?.id ?? '').trim();
    if (!uploadId) {
      return NextResponse.json({ ok: false, error: 'Upload id is required.' }, { status: 400 });
    }

    const currentPlanPrisma = getCurrentPlanPrisma();
    const upload = await (currentPlanPrisma.currentPlanBillUpload as any).findUnique({
      where: { id: uploadId },
      select: {
        id: true,
        filename: true,
        mimeType: true,
        billData: true,
      },
    });

    if (!upload?.id || !upload?.billData) {
      return NextResponse.json({ ok: false, error: 'Upload not found.' }, { status: 404 });
    }

    const body = Buffer.isBuffer(upload.billData)
      ? upload.billData
      : Buffer.from(upload.billData);

    return new NextResponse(body, {
      status: 200,
      headers: {
        'Content-Type': String(upload.mimeType || 'application/octet-stream'),
        'Content-Length': String(body.byteLength),
        'Cache-Control': 'no-store',
        'Content-Disposition': `inline; filename="${encodeURIComponent(String(upload.filename || 'bill-upload'))}"`,
        'x-upload-filename': encodeURIComponent(String(upload.filename || 'bill-upload')),
        'x-upload-mime-type': String(upload.mimeType || 'application/octet-stream'),
      },
    });
  } catch (error) {
    console.error('[admin/current-plan/uploads] Failed to read upload', error);
    return NextResponse.json({ ok: false, error: 'Failed to read upload.' }, { status: 500 });
  }
}
