import { prisma } from '@/lib/db';
// Intentionally using loose typings via `as any` to work across environments.

const USAGE_DEPENDENT_TYPES = new Set([
  'smart_meter_connect',
  'home_details_complete',
  'appliance_details_complete',
  'current_plan_details',
]);

const EXPIRING_SOON_WINDOW_DAYS = 30;

type EntryStatus = 'ACTIVE' | 'EXPIRING_SOON' | 'EXPIRED';

type ManualUsageRecord = {
  id: string;
  expiresAt: Date;
  uploadedAt: Date;
};

type EntryRecord = {
  id: string;
  type: string;
  amount: number;
  houseId: string | null;
  status: EntryStatus;
  expiresAt: Date | null;
  expirationReason: string | null;
  manualUsageId: string | null;
  createdAt: Date;
  lastValidated: Date | null;
};

type UsageContext = {
  now: Date;
  expiringSoonThreshold: Date;
  activeSmtExpiry: Date | null;
  hasActiveSmt: boolean;
  manualUploadsById: Map<string, ManualUsageRecord>;
  freshestManual: ManualUsageRecord | null;
};

type SmtAuthorizationSummary = {
  authorizationEndDate: Date | null;
  archivedAt: Date | null;
};

export type RefreshResult = {
  updatedEntryIds: string[];
  expiringSoonEntries: Array<{ id: string; type: string; expiresAt: Date }>;
};

export type EntryExpiryDigestRecord = {
  entryId: string;
  userId: string;
  entryType: string;
  status: EntryStatus;
  expiresAt: Date | null;
  recordedAt: Date;
  email: string | null;
};

async function buildUsageContext(userId: string): Promise<UsageContext> {
  const now = new Date();
  const expiringSoonThreshold = new Date(now.getTime() + EXPIRING_SOON_WINDOW_DAYS * 24 * 60 * 60 * 1000);

  const client = prisma as any;

  const [smtAuthorizations, manualUploads] = await Promise.all([
    client.smtAuthorization.findMany({
      where: { userId },
      select: {
        authorizationEndDate: true,
        archivedAt: true,
      },
    }),
    client.manualUsageUpload.findMany({
      where: { userId },
      select: {
        id: true,
        expiresAt: true,
        uploadedAt: true,
      },
    }),
  ]);

  const manualUploadsById = new Map<string, ManualUsageRecord>();
  let freshestManual: ManualUsageRecord | null = null;
  for (const manual of manualUploads) {
    manualUploadsById.set(manual.id, manual);
    if (!freshestManual || manual.uploadedAt > freshestManual.uploadedAt) {
      freshestManual = manual;
    }
  }

  const activeAuthorizations: SmtAuthorizationSummary[] = smtAuthorizations.filter(
    (auth: SmtAuthorizationSummary) => {
      if (auth.archivedAt) return false;
      if (!auth.authorizationEndDate) return true;
      return auth.authorizationEndDate > now;
    },
  );

  let activeSmtExpiry: Date | null = null;
  if (activeAuthorizations.length > 0) {
    const futureDates = activeAuthorizations
      .map((auth) => auth.authorizationEndDate)
      .filter((date): date is Date => !!date);

    if (futureDates.length === 0) {
      activeSmtExpiry = null;
    } else {
      activeSmtExpiry = futureDates.reduce((latest, current) => (current > latest ? current : latest), futureDates[0]!);
    }
  }

  return {
    now,
    expiringSoonThreshold,
    activeSmtExpiry,
    hasActiveSmt: activeAuthorizations.length > 0,
    manualUploadsById,
    freshestManual: freshestManual && freshestManual.expiresAt > now ? freshestManual : null,
  };
}

function computeEntryStatus(entry: EntryRecord, ctx: UsageContext) {
  let status: EntryStatus = entry.status;
  let expiresAt = entry.expiresAt ?? null;
  let reason: string | null = entry.expirationReason ?? null;
  const lastValidated = ctx.now;

  const isUsageDependent = USAGE_DEPENDENT_TYPES.has(entry.type);
  const manualId = entry.manualUsageId ?? undefined;
  const isManual = Boolean(manualId);

  if (!isUsageDependent) {
    return { status: 'ACTIVE', expiresAt: null, reason: null, lastValidated };
  }

  let candidateExpiry: Date | null = null;

  if (isManual && manualId) {
    const manual = ctx.manualUploadsById.get(manualId);
    if (manual) {
      candidateExpiry = manual.expiresAt;
    } else {
      candidateExpiry = ctx.now;
      status = 'EXPIRED';
      reason = 'Manual usage data removed';
    }
  } else {
    if (ctx.hasActiveSmt) {
      candidateExpiry = ctx.activeSmtExpiry;
    } else {
      candidateExpiry = ctx.now;
      status = 'EXPIRED';
      reason = 'No active usage data connection';
    }
  }

  if (status !== 'EXPIRED') {
    if (candidateExpiry && candidateExpiry <= ctx.now) {
      status = 'EXPIRED';
      reason = reason ?? 'Usage data expired';
    } else if (candidateExpiry && candidateExpiry <= ctx.expiringSoonThreshold) {
      status = 'EXPIRING_SOON';
      reason = null;
    } else {
      status = 'ACTIVE';
      reason = null;
    }
  }

  return {
    status,
    expiresAt: candidateExpiry ?? null,
    reason,
    lastValidated,
  };
}

export async function refreshUserEntryStatuses(userId: string): Promise<RefreshResult> {
  const ctx = await buildUsageContext(userId);

  const client = prisma as any;

  const rawEntries = await client.entry.findMany({
    where: { userId },
    select: {
      id: true,
      type: true,
      amount: true,
      houseId: true,
      status: true,
      expiresAt: true,
      expirationReason: true,
      manualUsageId: true,
      createdAt: true,
      lastValidated: true,
    },
  });

  const entries: EntryRecord[] = rawEntries.map((entry: any) => ({
    id: entry.id,
    type: entry.type,
    amount: entry.amount,
    houseId: entry.houseId,
    status: entry.status as EntryStatus,
    expiresAt: entry.expiresAt,
    expirationReason: entry.expirationReason ?? null,
    manualUsageId: entry.manualUsageId,
    createdAt: entry.createdAt,
    lastValidated: entry.lastValidated,
  }));

  const updatedEntryIds: string[] = [];
  const expiringSoonEntries: Array<{ id: string; type: string; expiresAt: Date }> = [];

  for (const entry of entries) {
    const { status, expiresAt, reason, lastValidated } = computeEntryStatus(entry, ctx);

    const needsUpdate =
      status !== entry.status ||
      (expiresAt?.getTime() ?? null) !== (entry.expiresAt?.getTime() ?? null) ||
      (reason ?? null) !== (entry.expirationReason ?? null) ||
      !entry.lastValidated ||
      Math.abs(entry.lastValidated.getTime() - lastValidated.getTime()) > 1_000;

    if (!needsUpdate) continue;

    const updateData = {
      status,
      expiresAt,
      expirationReason: reason,
      lastValidated,
    } as any;

    await client.entry.update({
      where: { id: entry.id },
      data: updateData,
    });

    await client.entryStatusLog.create({
      data: {
        entryId: entry.id,
        previous: entry.status,
        next: status,
        reason: reason ?? undefined,
      },
    });

    updatedEntryIds.push(entry.id);

    if (status === 'EXPIRING_SOON' && expiresAt) {
      expiringSoonEntries.push({ id: entry.id, type: entry.type, expiresAt });
    }
  }

  return { updatedEntryIds, expiringSoonEntries };
}

export async function refreshAllUsersAndBuildExpiryDigest(): Promise<EntryExpiryDigestRecord[]> {
  const client = prisma as any;
  const users = await client.user.findMany({
    select: { id: true },
  });

  for (const user of users) {
    await refreshUserEntryStatuses(user.id);
  }

  const flagged = await client.entry.findMany({
    where: {
      status: {
        in: ['EXPIRING_SOON', 'EXPIRED'],
      },
    },
    select: {
      id: true,
      type: true,
      status: true,
      expiresAt: true,
      userId: true,
      user: {
        select: { email: true },
      },
    },
  });

  await client.entryExpiryDigest.deleteMany({});

  let recordedAt: Date | null = null;

  if (flagged.length > 0) {
    recordedAt = new Date();
    await client.entryExpiryDigest.createMany({
      data: flagged.map((entry: any) => ({
        entryId: entry.id,
        userId: entry.userId,
        entryType: entry.type,
        status: entry.status,
        expiresAt: entry.expiresAt ?? null,
        recordedAt,
      })),
    });
  }

  return flagged.map((entry: any) => ({
    entryId: entry.id,
    userId: entry.userId,
    entryType: entry.type,
    status: entry.status as EntryStatus,
    expiresAt: entry.expiresAt ?? null,
    recordedAt: recordedAt ?? new Date(),
    email: entry.user?.email ?? null,
  }));
}

export async function getEntryExpiryDigestRecords(): Promise<EntryExpiryDigestRecord[]> {
  const client = prisma as any;
  const rows = await client.entryExpiryDigest.findMany({
    orderBy: { recordedAt: 'desc' },
    include: {
      user: { select: { email: true } },
    },
  });

  return rows.map((row: any) => ({
    entryId: row.entryId,
    userId: row.userId,
    entryType: row.entryType,
    status: row.status as EntryStatus,
    expiresAt: row.expiresAt ?? null,
    recordedAt: row.recordedAt,
    email: row.user?.email ?? null,
  }));
}

