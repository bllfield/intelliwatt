'use server';

import { randomUUID } from 'crypto';
import { headers } from 'next/headers';
import { prisma } from '@/lib/db';
import { resolveAddressToEsiid } from '@/lib/resolver/addressToEsiid';
import { cleanEsiid } from '@/lib/smt/esiid';
import { waitForMeterInfo } from '@/lib/smt/meterInfo';
import { createAgreementAndSubscription, type SmtAgreementResult } from '@/lib/smt/agreements';

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

export type MonitorAuthorizationWithMeter = MonitorAuthorization & {
  meterInfo: MonitorMeterInfo | null;
};

export type SmtPullStatusesPayload = {
  fetchedAt: string;
  authorizations: MonitorAuthorizationWithMeter[];
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

  const meterInfosTyped = meterInfos as MonitorMeterInfo[];
  const latestMeterByEsiid = new Map<string, MonitorMeterInfo>();
  for (const info of meterInfosTyped) {
    const key = info.esiid;
    const existing = latestMeterByEsiid.get(key);
    if (!existing || existing.updatedAt < info.updatedAt) {
      latestMeterByEsiid.set(key, info);
    }
  }

  const authorizationsWithMeter = (authorizations as MonitorAuthorization[]).map(
    (auth) => ({
      ...auth,
      meterInfo: latestMeterByEsiid.get(auth.esiid) ?? null,
    }),
  );

  return {
    fetchedAt: new Date().toISOString(),
    authorizations: authorizationsWithMeter,
    meterInfos: meterInfosTyped,
  };
}

export type AdminAgreementTestInput = {
  addressLine1: string;
  addressLine2?: string;
  city: string;
  state: string;
  zip: string;
  customerName: string;
  customerEmail: string;
  repPuctNumber: string;
  esiidOverride?: string;
  monthsBack?: number;
  includeInterval?: boolean;
  includeBilling?: boolean;
};

export type AdminAgreementTestResult = {
  ok: boolean;
  esiid?: string;
  meterNumber?: string | null;
  meterInfoWaitMs?: number;
  agreement?: SmtAgreementResult | null;
  wattbuy?: {
    esiid: string | null;
    utility?: string | null;
    territory?: string | null;
  } | null;
  meterInfoRecord?: {
    id: string;
    status: string;
    meterNumber: string | null;
    updatedAt: string;
  } | null;
  messages?: string[];
  errors?: string[];
  tookMs?: number;
};

export type AdminMeterPipelineTestInput = {
  addressLine1: string;
  addressLine2?: string;
  city: string;
  state: string;
  zip: string;
  esiidOverride?: string;
};

export type AdminMeterPipelineTestResult = {
  ok: boolean;
  esiid?: string | null;
  meterNumber?: string | null;
  meterInfoWaitMs?: number;
  wattbuy?: {
    esiid: string | null;
    utility?: string | null;
    territory?: string | null;
  } | null;
  meterInfoRecord?: {
    id: string;
    status: string;
    meterNumber: string | null;
    updatedAt: string;
  } | null;
  messages?: string[];
  errors?: string[];
  tookMs?: number;
};

export async function runSmtAgreementTest(
  input: AdminAgreementTestInput,
): Promise<AdminAgreementTestResult> {
  const startedAt = Date.now();
  const errors: string[] = [];
  const messages: string[] = [];

  const addressLine1 = input.addressLine1?.trim();
  const city = input.city?.trim();
  const state = input.state?.trim().toUpperCase();
  const zip = input.zip?.trim();
  const customerName = input.customerName?.trim();
  const customerEmail = input.customerEmail?.trim();
  const repRaw = input.repPuctNumber?.toString().trim();
  const addressLine2 = input.addressLine2?.trim() || undefined;

  if (!addressLine1) errors.push("Address line 1 is required.");
  if (!city) errors.push("City is required.");
  if (!state) errors.push("State is required.");
  if (!zip) errors.push("ZIP code is required.");
  if (!customerName) errors.push("Customer name is required.");
  if (!customerEmail) errors.push("Customer email is required.");
  if (!repRaw) errors.push("REP PUCT number is required.");

  const repNumeric = repRaw ? Number.parseInt(repRaw, 10) : NaN;
  if (!Number.isFinite(repNumeric)) {
    errors.push("REP PUCT number must be numeric.");
  }

  const monthsBack =
    typeof input.monthsBack === "number" && Number.isFinite(input.monthsBack)
      ? Math.max(1, Math.round(input.monthsBack))
      : 12;
  const includeInterval = input.includeInterval ?? true;
  const includeBilling = input.includeBilling ?? true;

  if (errors.length > 0) {
    return {
      ok: false,
      errors,
      messages,
      tookMs: Date.now() - startedAt,
    };
  }

  let esiid = cleanEsiid(input.esiidOverride ?? null);
  let wattbuyResult: Awaited<ReturnType<typeof resolveAddressToEsiid>> | null = null;

  if (esiid) {
    messages.push(`Using provided ESIID ${esiid}.`);
  } else {
    wattbuyResult = await resolveAddressToEsiid({
      line1: addressLine1,
      line2: addressLine2 ?? null,
      line1Alt: null,
      city,
      state,
      zip,
    });

    esiid = cleanEsiid(wattbuyResult.esiid ?? null);
    if (esiid) {
      messages.push(`Resolved ESIID ${esiid} via WattBuy.`);
    } else {
      errors.push("WattBuy could not resolve an ESIID for the supplied address.");
      return {
        ok: false,
        errors,
        messages,
        wattbuy: {
          esiid: wattbuyResult?.esiid ?? null,
          utility: wattbuyResult?.utility ?? null,
          territory: wattbuyResult?.territory ?? null,
        },
        tookMs: Date.now() - startedAt,
      };
    }
  }

  const houseId = randomUUID();
  const meterStart = Date.now();
  let meterNumber: string | null = null;

  try {
    meterNumber = await waitForMeterInfo({
      houseId,
      esiid,
      timeoutMs: 60_000,
      pollIntervalMs: 3_000,
      queueIfMissing: true,
    });
  } catch (err) {
    errors.push(
      `Meter info lookup failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  const meterInfoWaitMs = Date.now() - meterStart;

  const prismaAny = prisma as any;
  const meterInfoRecord = await prismaAny.smtMeterInfo.findFirst({
    where: {
      esiid,
      OR: [{ houseId }, { houseId: null }],
    },
    orderBy: { updatedAt: "desc" },
    select: {
      id: true,
      status: true,
      meterNumber: true,
      updatedAt: true,
    },
  });

  if (!meterNumber) {
    errors.push(
      "Meter number was not returned in time. Check SMT meter info pipeline or try again.",
    );
    return {
      ok: false,
      errors,
      messages,
      esiid,
      meterNumber: null,
      meterInfoWaitMs,
      wattbuy: wattbuyResult
        ? {
            esiid: wattbuyResult.esiid,
            utility: wattbuyResult.utility ?? null,
            territory: wattbuyResult.territory ?? null,
          }
        : esiid
        ? null
        : null,
      meterInfoRecord: meterInfoRecord
        ? {
            id: meterInfoRecord.id,
            status: meterInfoRecord.status,
            meterNumber: meterInfoRecord.meterNumber,
            updatedAt: meterInfoRecord.updatedAt.toISOString(),
          }
        : null,
      tookMs: Date.now() - startedAt,
    };
  }

  const serviceAddressParts = [
    addressLine1,
    addressLine2,
    `${city}, ${state} ${zip}`,
  ].filter((part) => part && part.trim().length > 0);

  let agreementResult: SmtAgreementResult | null = null;

  try {
    agreementResult = await createAgreementAndSubscription({
      esiid,
      serviceAddress: serviceAddressParts.join(", "),
      customerName,
      customerEmail,
      customerPhone: null,
      tdspCode: (wattbuyResult?.territory ?? null) || null,
      monthsBack,
      includeInterval,
      includeBilling,
      meterNumber,
      repPuctNumber: String(repNumeric),
    });
    messages.push("SMT agreement/subscription request completed.");
  } catch (err) {
    errors.push(
      `Agreement call threw: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  return {
    ok: errors.length === 0,
    esiid,
    meterNumber,
    meterInfoWaitMs,
    agreement: agreementResult,
    wattbuy: wattbuyResult
      ? {
          esiid: wattbuyResult.esiid,
          utility: wattbuyResult.utility ?? null,
          territory: wattbuyResult.territory ?? null,
        }
      : esiid
      ? null
      : null,
    meterInfoRecord: meterInfoRecord
      ? {
          id: meterInfoRecord.id,
          status: meterInfoRecord.status,
          meterNumber: meterInfoRecord.meterNumber,
          updatedAt: meterInfoRecord.updatedAt.toISOString(),
        }
      : null,
    messages,
    errors: errors.length > 0 ? errors : undefined,
    tookMs: Date.now() - startedAt,
  };
}

export async function runSmtMeterPipelineTest(
  input: AdminMeterPipelineTestInput,
): Promise<AdminMeterPipelineTestResult> {
  const startedAt = Date.now();
  const messages: string[] = [];
  const errors: string[] = [];

  const addressLine1 = input.addressLine1?.trim();
  const city = input.city?.trim();
  const state = input.state?.trim().toUpperCase();
  const zip = input.zip?.trim();
  const addressLine2 = input.addressLine2?.trim() || undefined;

  if (!addressLine1) errors.push("Address line 1 is required.");
  if (!city) errors.push("City is required.");
  if (!state) errors.push("State is required.");
  if (!zip) errors.push("ZIP code is required.");

  if (errors.length > 0) {
    return {
      ok: false,
      errors,
      messages,
      tookMs: Date.now() - startedAt,
    };
  }

  let esiid = cleanEsiid(input.esiidOverride ?? null);
  let wattbuyResult: Awaited<ReturnType<typeof resolveAddressToEsiid>> | null = null;

  if (esiid) {
    messages.push(`Using provided ESIID ${esiid}.`);
  } else {
    wattbuyResult = await resolveAddressToEsiid({
      line1: addressLine1,
      line2: addressLine2 ?? null,
      line1Alt: null,
      city,
      state,
      zip,
    });

    esiid = cleanEsiid(wattbuyResult.esiid ?? null);
    if (esiid) {
      messages.push(`Resolved ESIID ${esiid} via WattBuy.`);
    } else {
      errors.push("WattBuy could not resolve an ESIID for the supplied address.");
      return {
        ok: false,
        errors,
        messages,
        wattbuy: {
          esiid: wattbuyResult?.esiid ?? null,
          utility: wattbuyResult?.utility ?? null,
          territory: wattbuyResult?.territory ?? null,
        },
        tookMs: Date.now() - startedAt,
      };
    }
  }

  const houseId = randomUUID();
  let meterNumber: string | null = null;
  const meterStart = Date.now();

  try {
    meterNumber = await waitForMeterInfo({
      houseId,
      esiid,
      timeoutMs: 60_000,
      pollIntervalMs: 3_000,
      queueIfMissing: true,
    });
  } catch (err) {
    errors.push(
      `Meter info lookup failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  const meterInfoWaitMs = Date.now() - meterStart;

  const prismaAny = prisma as any;
  const meterInfoRecord = await prismaAny.smtMeterInfo.findFirst({
    where: {
      esiid,
      OR: [{ houseId }, { houseId: null }],
    },
    orderBy: { updatedAt: "desc" },
    select: {
      id: true,
      status: true,
      meterNumber: true,
      updatedAt: true,
    },
  });

  if (!meterNumber) {
    errors.push(
      "Meter number was not returned in time. Check SMT meter info pipeline or try again.",
    );
  } else {
    messages.push(`Meter number retrieved: ${meterNumber}`);
  }

  return {
    ok: errors.length === 0,
    esiid,
    meterNumber,
    meterInfoWaitMs,
    wattbuy: wattbuyResult
      ? {
          esiid: wattbuyResult.esiid,
          utility: wattbuyResult.utility ?? null,
          territory: wattbuyResult.territory ?? null,
        }
      : esiid
      ? null
      : null,
    meterInfoRecord: meterInfoRecord
      ? {
          id: meterInfoRecord.id,
          status: meterInfoRecord.status,
          meterNumber: meterInfoRecord.meterNumber,
          updatedAt: meterInfoRecord.updatedAt.toISOString(),
        }
      : null,
    messages,
    errors: errors.length > 0 ? errors : undefined,
    tookMs: Date.now() - startedAt,
  };
}
