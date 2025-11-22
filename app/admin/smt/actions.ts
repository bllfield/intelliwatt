'use server';

import { headers } from 'next/headers';
import { prisma } from '@/lib/db';

function resolveBaseUrl() {
  const explicit = process.env.ADMIN_INTERNAL_BASE_URL
    ?? process.env.NEXT_PUBLIC_BASE_URL
    ?? process.env.PROD_BASE_URL
    ?? process.env.VERCEL_PROJECT_PRODUCTION_URL
    ?? '';

  if (explicit) {
    try {
      return new URL(explicit.startsWith('http') ? explicit : `https://${explicit}`);
    } catch {
      // fall through to host-based resolution below
    }
  }

  const incomingHeaders = headers();
  const host = incomingHeaders.get('host') ?? 'localhost:3000';
  const protocol = host.startsWith('localhost') || host.startsWith('127.0.0.1') ? 'http' : 'https';
  return new URL(`${protocol}://${host}`);
}

export async function normalizeLatestServerAction(limit = 5) {
  const adminToken = process.env.ADMIN_TOKEN;
  if (!adminToken) {
    throw new Error('ADMIN_TOKEN is not configured on the server');
  }

  const baseUrl = resolveBaseUrl();
  const url = new URL(`/api/admin/smt/normalize?limit=${encodeURIComponent(Math.max(1, limit))}`, baseUrl);

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'x-admin-token': adminToken,
      'content-type': 'application/json',
    },
    cache: 'no-store',
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Normalize failed: ${res.status} ${text}`.trim());
  }

  return res.json();
}

type MonitorAddress = {
  addressLine1: string | null;
  addressCity: string | null;
  addressState: string | null;
  addressZip5: string | null;
};

export type MonitorAuthorization = {
  id: string;
  esiid: string;
  smtStatus: string | null;
  smtStatusMessage: string | null;
  smtAgreementId: string | null;
  smtSubscriptionId: string | null;
  smtBackfillRequestedAt: Date | null;
  smtBackfillCompletedAt: Date | null;
  smtLastSyncAt: Date | null;
  updatedAt: Date;
  createdAt: Date;
  houseId: string;
  houseAddressId: string;
  houseAddress: MonitorAddress | null;
};

export type MonitorMeterInfo = {
  id: string;
  esiid: string;
  houseId: string | null;
  status: string;
  errorMessage: string | null;
  meterNumber: string | null;
  updatedAt: Date;
  createdAt: Date;
};

export type SmtPullStatusesPayload = {
  fetchedAt: string;
  authorizations: MonitorAuthorization[];
  meterInfos: MonitorMeterInfo[];
};

const monitorSelect = {
  id: true,
  esiid: true,
  smtStatus: true,
  smtStatusMessage: true,
  smtAgreementId: true,
  smtSubscriptionId: true,
  smtBackfillRequestedAt: true,
  smtBackfillCompletedAt: true,
  smtLastSyncAt: true,
  updatedAt: true,
  createdAt: true,
  houseId: true,
  houseAddressId: true,
  houseAddress: {
    select: {
      addressLine1: true,
      addressCity: true,
      addressState: true,
      addressZip5: true,
    },
  },
} satisfies Record<string, unknown>;

const meterInfoSelect = {
  id: true,
  esiid: true,
  houseId: true,
  status: true,
  errorMessage: true,
  meterNumber: true,
  updatedAt: true,
  createdAt: true,
} satisfies Record<string, unknown>;

export async function fetchSmtPullStatuses(limit = 10): Promise<SmtPullStatusesPayload> {
  const take = Math.min(Math.max(1, limit), 50);
  const prismaAny = prisma as any;

  const [authorizations, meterInfos] = await Promise.all([
    prisma.smtAuthorization.findMany({
      take,
      orderBy: { updatedAt: 'desc' },
      select: monitorSelect,
    }),
    prismaAny.smtMeterInfo.findMany({
      take,
      orderBy: { updatedAt: 'desc' },
      select: meterInfoSelect,
    }),
  ]);

  return {
    fetchedAt: new Date().toISOString(),
    authorizations: authorizations as MonitorAuthorization[],
    meterInfos: meterInfos as MonitorMeterInfo[],
  };
}
