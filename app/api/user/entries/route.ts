import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { db } from '@/lib/db';
import { normalizeEmail } from '@/lib/utils/email';
import { refreshUserEntryStatuses } from '@/lib/hitthejackwatt/entryLifecycle';
import { qualifyReferralsForUser } from '@/lib/referral/qualify';
import { ensureSmartMeterEntry } from '@/lib/smt/ensureSmartMeterEntry';

const COMMISSION_STATUS_ALLOWLIST = ['pending', 'submitted', 'approved', 'completed', 'paid'];

type EntryRow = {
  id: string;
  type: string;
  amount: number;
  houseId: string | null;
  createdAt: Date;
  status: 'ACTIVE' | 'EXPIRING_SOON' | 'EXPIRED';
  expiresAt: Date | null;
  manualUsageId: string | null;
  lastValidated: Date | null;
};

export const dynamic = 'force-dynamic';

// GET user's entries
export async function GET(request: NextRequest) {
  try {
    const cookieStore = cookies();
    const userEmailRaw = cookieStore.get('intelliwatt_user')?.value;
    
    if (!userEmailRaw) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    }

    // Normalize email to lowercase for consistent lookup
    const userEmail = normalizeEmail(userEmailRaw);

    const user = await db.user.findUnique({
      where: { email: userEmail },
      select: { id: true },
    });

    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    await refreshUserEntryStatuses(user.id);

    let rawEntries: any[];
    let qualifyingCommission: { id: string } | null;

    const fetchEntriesAndCommission = async () => {
      const [entriesResult, commissionResult] = await Promise.all([
        db.entry.findMany({
          where: { userId: user.id },
          orderBy: { createdAt: 'desc' },
          select: {
            id: true,
            type: true,
            amount: true,
            houseId: true,
            createdAt: true,
            status: true,
            expiresAt: true,
            manualUsageId: true,
            lastValidated: true,
          } as any,
        }) as Promise<any[]>,
        db.commissionRecord.findFirst({
          where: {
            userId: user.id,
            status: { in: COMMISSION_STATUS_ALLOWLIST },
            OR: [
              { type: { contains: 'switch', mode: 'insensitive' } },
              { type: { contains: 'plan', mode: 'insensitive' } },
              { type: { contains: 'upgrade', mode: 'insensitive' } },
            ],
          },
          select: { id: true },
        }),
      ]);
      return { rawEntries: entriesResult, qualifyingCommission: commissionResult };
    };

    const first = await fetchEntriesAndCommission();
    rawEntries = first.rawEntries;
    qualifyingCommission = first.qualifyingCommission;

    let entries: EntryRow[] = (rawEntries as any[]).map((entry: any) => ({
      id: entry.id,
      type: entry.type,
      amount: entry.amount,
      houseId: entry.houseId,
      createdAt: entry.createdAt,
      status: entry.status as EntryRow['status'],
      expiresAt: entry.expiresAt,
      manualUsageId: entry.manualUsageId,
      lastValidated: entry.lastValidated,
    }));

    let hasActiveUsage = entries.some(
      (entry) =>
        entry.type === 'smart_meter_connect' &&
        (entry.status === 'ACTIVE' || entry.status === 'EXPIRING_SOON'),
    );

    if (!hasActiveUsage) {
      const now = new Date();
      const activeSmt = await (db as any).smtAuthorization.findFirst({
        where: {
          userId: user.id,
          archivedAt: null,
        },
        orderBy: { createdAt: 'desc' },
        select: { houseAddressId: true, authorizationEndDate: true },
      });
      const smtActive =
        activeSmt &&
        (activeSmt.authorizationEndDate == null || new Date(activeSmt.authorizationEndDate) > now);
      if (smtActive && activeSmt.houseAddressId) {
        try {
          await ensureSmartMeterEntry(user.id, activeSmt.houseAddressId, now);
          await refreshUserEntryStatuses(user.id);
          const second = await fetchEntriesAndCommission();
          rawEntries = second.rawEntries;
          qualifyingCommission = second.qualifyingCommission;
          entries = (rawEntries as any[]).map((entry: any) => ({
            id: entry.id,
            type: entry.type,
            amount: entry.amount,
            houseId: entry.houseId,
            createdAt: entry.createdAt,
            status: entry.status as EntryRow['status'],
            expiresAt: entry.expiresAt,
            manualUsageId: entry.manualUsageId,
            lastValidated: entry.lastValidated,
          }));
          hasActiveUsage = entries.some(
            (e) =>
              e.type === 'smart_meter_connect' &&
              (e.status === 'ACTIVE' || e.status === 'EXPIRING_SOON'),
          );
        } catch (syncErr) {
          console.error('[user/entries] ensureSmartMeterEntry sync failed', syncErr);
        }
      }
    }

    const countedEntries = entries.filter(
      (entry) => entry.status === 'ACTIVE' || entry.status === 'EXPIRING_SOON',
    );
    const total = countedEntries.reduce((sum, entry) => sum + entry.amount, 0);

    return NextResponse.json({
      entries: entries.map((e) => ({
        id: e.id,
        type: e.type,
        amount: e.amount,
        houseId: e.houseId,
        status: e.status,
        expiresAt: e.expiresAt ? e.expiresAt.toISOString() : null,
        manualUsageId: e.manualUsageId ?? null,
        createdAt: e.createdAt.toISOString(),
        lastValidated: e.lastValidated ? e.lastValidated.toISOString() : null,
      })),
      total,
      hasActiveUsage,
      testimonialEligible: Boolean(qualifyingCommission),
    });
  } catch (error) {
    console.error('Error fetching entries:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

// POST - Award entries (called internally when actions complete)
export async function POST(request: NextRequest) {
  try {
    const cookieStore = cookies();
    const userEmailRaw = cookieStore.get('intelliwatt_user')?.value;
    
    if (!userEmailRaw) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    }

    // Normalize email to lowercase for consistent lookup
    const userEmail = normalizeEmail(userEmailRaw);

    const body = await request.json();
    const { type, amount, houseId: rawHouseId, manualUsageId: rawManualUsageId } = body;
    const houseId = typeof rawHouseId === 'string' && rawHouseId.trim().length > 0 ? rawHouseId.trim() : null;
    const manualUsageId =
      typeof rawManualUsageId === 'string' && rawManualUsageId.trim().length > 0
        ? rawManualUsageId.trim()
        : null;

    if (!type || typeof amount !== 'number') {
      return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
    }

    const user = await db.user.findUnique({
      where: { email: userEmail },
      select: { id: true },
    });

    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    const attemptReferralQualification = async () => {
      if (type !== 'smart_meter_connect') {
        return;
      }

      if (manualUsage) {
        await qualifyReferralsForUser(user.id);
        return;
      }

      const authorization = await (db as any).smtAuthorization.findFirst({
        where: {
          userId: user.id,
          archivedAt: null,
        },
        orderBy: {
          createdAt: 'desc',
        },
        select: {
          emailConfirmationStatus: true,
        },
      });

      if (authorization?.emailConfirmationStatus === 'APPROVED') {
        await qualifyReferralsForUser(user.id);
      }
    };

    if (houseId) {
      const ownsHouse = await db.houseAddress.findFirst({
        where: { id: houseId, userId: user.id },
        select: { id: true },
      });

      if (!ownsHouse) {
        return NextResponse.json({ error: 'House not found for user' }, { status: 403 });
      }
    }

    let manualUsage: { id: string } | null = null;
    if (manualUsageId) {
      manualUsage = await (db as any).manualUsageUpload.findFirst({
        where: { id: manualUsageId, userId: user.id },
        select: { id: true },
      });

      if (!manualUsage) {
        return NextResponse.json({ error: 'Manual usage record not found' }, { status: 403 });
      }
    }

    // Check if entry already exists for this type (if it's a one-time entry)
    const existing = await db.entry.findFirst({
      where: {
        userId: user.id,
        type: type,
        houseId: houseId ?? null,
      },
    });

    if (existing) {
      const existingEntry = existing as any;

      if (amount > existingEntry.amount) {
        const updated = await db.entry.update({
          where: { id: existingEntry.id },
          data: {
            amount,
            manualUsageId: manualUsage?.id ?? existingEntry.manualUsageId,
            lastValidated: new Date(),
          } as any,
        });

        await refreshUserEntryStatuses(user.id);

        if (type === 'smart_meter_connect') {
          await attemptReferralQualification();
        }

        const updatedEntry = updated as any;

        return NextResponse.json({
          message: 'Entry amount updated',
          entry: {
            id: updatedEntry.id,
            type: updatedEntry.type,
            amount: updatedEntry.amount,
            houseId: updatedEntry.houseId,
            status: updatedEntry.status,
            expiresAt: updatedEntry.expiresAt,
            manualUsageId: updatedEntry.manualUsageId,
          },
        });
      }

      if (manualUsage && existingEntry.manualUsageId !== manualUsage.id) {
        await db.entry.update({
          where: { id: existingEntry.id },
          data: {
            manualUsageId: manualUsage.id,
            lastValidated: new Date(),
          } as any,
        });
        await refreshUserEntryStatuses(user.id);

        if (type === 'smart_meter_connect') {
          await attemptReferralQualification();
        }
      }

      return NextResponse.json({
        message: 'Entry already awarded',
        entry: {
          id: existingEntry.id,
          type: existingEntry.type,
          amount: existingEntry.amount,
          houseId: existingEntry.houseId,
          status: existingEntry.status,
          expiresAt: existingEntry.expiresAt,
          manualUsageId: existingEntry.manualUsageId,
        },
      });
    }

    // Create entry
    const entry = await db.entry.create({
      data: {
        userId: user.id,
        type: type,
        amount: amount,
        houseId,
        manualUsageId: manualUsage?.id,
        lastValidated: new Date(),
      } as any,
    });

    await refreshUserEntryStatuses(user.id);

    if (type === 'smart_meter_connect') {
      await attemptReferralQualification();
    }

    const createdEntry = entry as any;

    return NextResponse.json({
      message: 'Entry awarded',
      entry: {
        id: createdEntry.id,
        type: createdEntry.type,
        amount: createdEntry.amount,
        houseId: createdEntry.houseId,
        status: createdEntry.status,
        expiresAt: createdEntry.expiresAt,
        manualUsageId: createdEntry.manualUsageId,
      },
    });
  } catch (error) {
    console.error('Error awarding entry:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

