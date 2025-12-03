"use server";

import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';

import { normalizeEmail } from '@/lib/utils/email';
import { prisma } from '@/lib/db';
import { getCurrentPlanPrisma } from '@/lib/prismaCurrentPlan';
import { ensureCurrentPlanEntry } from '@/lib/current-plan/ensureEntry';
import { normalizeCurrentPlanForUserOrHome } from '@/lib/normalization/currentPlan';

export const dynamic = 'force-dynamic';

type ReconfirmPayload = {
  houseId?: unknown;
};

const toNullableString = (value: unknown): string | null => {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }
  return null;
};

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

    const body = (await request.json().catch(() => null)) as ReconfirmPayload | null;
    const requestedHouseId = body ? toNullableString(body.houseId) : null;

    const currentPlanPrisma = getCurrentPlanPrisma();
    const manualEntryDelegate = currentPlanPrisma.currentPlanManualEntry as any;

    const latestPlan = await manualEntryDelegate.findFirst({
      where: {
        userId: user.id,
        ...(requestedHouseId ? { houseId: requestedHouseId } : {}),
      },
      orderBy: { updatedAt: 'desc' },
    });

    if (!latestPlan) {
      return NextResponse.json(
        { error: 'No saved current plan found for this account.' },
        { status: 404 },
      );
    }

    const targetHouseId =
      requestedHouseId ?? (typeof latestPlan.houseId === 'string' ? latestPlan.houseId : null);

    const now = new Date();

    await manualEntryDelegate.update({
      where: { id: latestPlan.id as string },
      data: {
        lastConfirmedAt: now,
        normalizedAt: null,
      },
    });

    const entryResult = await ensureCurrentPlanEntry(user.id, targetHouseId);

    try {
      await normalizeCurrentPlanForUserOrHome({
        userId: user.id,
        homeId: targetHouseId ?? undefined,
      });
    } catch (normalizationError) {
      console.error('[current-plan/reconfirm] Failed to normalize current plan', normalizationError);
    }

    const planEntry = await prisma.entry.findFirst({
      where: {
        userId: user.id,
        type: 'current_plan_details',
        ...(targetHouseId ? { houseId: targetHouseId } : { houseId: null }),
      },
    orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        status: true,
        expiresAt: true,
        lastValidated: true,
        amount: true,
        houseId: true,
      },
    });

    const usageEntry = await prisma.entry.findFirst({
      where: {
        userId: user.id,
        type: 'smart_meter_connect',
        ...(targetHouseId ? { houseId: targetHouseId } : {}),
      },
    orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        status: true,
        expiresAt: true,
        lastValidated: true,
        houseId: true,
      },
    });

    const usageStatus = usageEntry?.status ?? null;
    const hasActiveUsage = usageStatus === 'ACTIVE' || usageStatus === 'EXPIRING_SOON';

    return NextResponse.json({
      ok: true,
      id: latestPlan.id as string,
      entryAwarded: entryResult.entryAwarded,
      alreadyAwarded: entryResult.alreadyAwarded,
      entry: planEntry
        ? {
            ...planEntry,
            expiresAt: planEntry.expiresAt ? planEntry.expiresAt.toISOString() : null,
            lastValidated: planEntry.lastValidated ? planEntry.lastValidated.toISOString() : null,
          }
        : null,
      usage: usageEntry
        ? {
            ...usageEntry,
            expiresAt: usageEntry.expiresAt ? usageEntry.expiresAt.toISOString() : null,
            lastValidated: usageEntry.lastValidated ? usageEntry.lastValidated.toISOString() : null,
          }
        : null,
      hasActiveUsage,
    });
  } catch (error) {
    console.error('[current-plan/reconfirm] Failed to reconfirm plan', error);
    return NextResponse.json(
      { error: 'Failed to reconfirm current plan' },
      { status: 500 },
    );
  }
}


