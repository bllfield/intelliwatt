import { cookies } from 'next/headers';
import { NextRequest, NextResponse } from 'next/server';
import { normalizeEmail } from '@/lib/utils/email';
import { prisma } from '@/lib/db';
import { getCurrentPlanPrisma } from '@/lib/prismaCurrentPlan';
import { ensureCurrentPlanEntry } from '@/lib/current-plan/ensureEntry';

const MAX_UPLOAD_BYTES = 10 * 1024 * 1024; // 10 MB

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  try {
    if (!process.env.CURRENT_PLAN_DATABASE_URL) {
      return NextResponse.json(
        { error: 'CURRENT_PLAN_DATABASE_URL is not configured' },
        { status: 500 },
      );
    }

    const cookieStore = cookies();
    const userEmailRaw = cookieStore.get('intelliwatt_user')?.value ?? null;

    if (!userEmailRaw) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    }

    const userEmail = normalizeEmail(userEmailRaw);
    const user = await prisma.user.findUnique({
      where: { email: userEmail },
      select: { id: true },
    });

    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    const formData = await request.formData();
    const billFilesRaw = formData.getAll('billFile');
    const billFiles = billFilesRaw.filter((item): item is File => item instanceof File);

    if (billFiles.length === 0) {
      return NextResponse.json({ error: 'billFile is required' }, { status: 400 });
    }

    const houseIdRaw = formData.get('houseId');
    const houseId =
      typeof houseIdRaw === 'string' && houseIdRaw.trim().length > 0 ? houseIdRaw.trim() : null;

    if (houseId) {
      const ownsHouse = await prisma.houseAddress.findFirst({
        where: { id: houseId, userId: user.id },
        select: { id: true },
      });

      if (!ownsHouse) {
        return NextResponse.json({ error: 'houseId does not belong to the current user' }, { status: 403 });
      }
    }

    const currentPlanPrisma = getCurrentPlanPrisma();

    for (const billFile of billFiles) {
      const arrayBuffer = await billFile.arrayBuffer();
      if (arrayBuffer.byteLength === 0) {
        return NextResponse.json({ error: 'Uploaded file is empty' }, { status: 400 });
      }

      if (arrayBuffer.byteLength > MAX_UPLOAD_BYTES) {
        return NextResponse.json(
          { error: `File exceeds ${MAX_UPLOAD_BYTES / (1024 * 1024)} MB limit` },
          { status: 413 },
        );
      }

      const buffer = Buffer.from(arrayBuffer);

      await currentPlanPrisma.currentPlanBillUpload.create({
        data: {
          userId: user.id,
          houseId,
          filename: billFile.name?.slice(0, 255) ?? 'current-plan-upload',
          mimeType: billFile.type?.slice(0, 128) ?? 'application/octet-stream',
          sizeBytes: buffer.length,
          billData: buffer,
        },
      });
    }

    const entryResult = await ensureCurrentPlanEntry(user.id, houseId);

    return NextResponse.json({
      ok: true,
      entryAwarded: entryResult.entryAwarded,
      alreadyAwarded: entryResult.alreadyAwarded,
    });
  } catch (error) {
    console.error('[current-plan/upload] Failed to save bill upload', error);
    return NextResponse.json({ error: 'Failed to save bill upload' }, { status: 500 });
  }
}

