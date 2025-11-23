import { randomBytes } from "crypto";

export type SmtAgreementRequest = {
  esiid: string;
  serviceAddress: string;
  customerName?: string | null;
  customerEmail?: string | null;
  customerPhone?: string | null;
  tdspCode?: string | null;
  monthsBack?: number | null;
  includeInterval?: boolean | null;
  includeBilling?: boolean | null;
  meterNumber?: string | null;
  repPuctNumber?: number | null;
};

export type SmtAgreementResult = {
  ok: boolean;
  agreementId?: string;
  subscriptionId?: string;
  status?: string;
  message?: string;
  backfillRequestedAt?: string;
  backfillCompletedAt?: string;
};

// Feature flag to hard-disable SMT agreements from env.
const SMT_AGREEMENTS_ENABLED =
  process.env.SMT_AGREEMENTS_ENABLED === "true" ||
  process.env.SMT_AGREEMENTS_ENABLED === "1";

// Droplet proxy wiring (already configured in Vercel).
const SMT_PROXY_AGREEMENTS_URL =
  process.env.SMT_PROXY_AGREEMENTS_URL ||
  process.env.SMT_PROXY_URL ||
  "";

const SMT_PROXY_TOKEN = process.env.SMT_PROXY_TOKEN || "";

// SMT agreement/subscription identity wiring.
// These must match what’s configured in the SMT portal.
const SMT_USERNAME = (
  process.env.SMT_USERNAME ||
  process.env.SMT_SERVICE_ID ||
  process.env.SMT_REQUESTOR_ID ||
  "INTELLIPATH"
).trim();

const SMT_SERVICE_ID = (
  process.env.SMT_SERVICE_ID ||
  SMT_USERNAME ||
  "INTELLIPATH"
).trim();

const SMT_REQUESTOR_ID = (
  process.env.SMT_REQUESTOR_ID ||
  SMT_SERVICE_ID ||
  "INTELLIPATH"
).trim();

const SMT_REQUESTOR_AUTH_ID = (
  process.env.SMT_REQUESTOR_AUTH_ID ||
  "134642921"
).trim();

export const DEFAULT_REP_PUCT_NUMBER = (() => {
  const raw = process.env.SMT_DEFAULT_REP_PUCT_NUMBER?.trim();
  if (!raw) {
    return 10052;
  }
  const parsed = Number.parseInt(raw, 10);
  return Number.isNaN(parsed) ? 10052 : parsed;
})();

// Default language preference for SMT notifications.
const SMT_LANG_DEFAULT =
  (process.env.SMT_LANG_DEFAULT || "ENGLISH").trim() || "ENGLISH";

function buildTransId(): string {
  return randomBytes(16).toString("hex");
}

function normalizeEsiid(esiid: string): string {
  const digits = (esiid || "").replace(/\D/g, "");
  if (!digits) {
    return esiid;
  }
  const trimmed = digits.slice(-17);
  return trimmed.padStart(17, "0");
}

interface SmtIdentity {
  requestorID: string;
  requesterAuthenticationID: string;
  serviceID: string;
  username: string;
  language: string;
}

function buildSmtIdentity(
  overrides?: Partial<SmtIdentity>,
): SmtIdentity {
  return {
    requestorID: SMT_REQUESTOR_ID,
    requesterAuthenticationID: SMT_REQUESTOR_AUTH_ID,
    serviceID: SMT_SERVICE_ID,
    username: SMT_USERNAME,
    language: SMT_LANG_DEFAULT,
    ...overrides,
  };
}

if (!SMT_USERNAME) {
  throw new Error("SMT_USERNAME is required for SMT agreements (SMT service ID).");
}
if (!SMT_REQUESTOR_AUTH_ID) {
  throw new Error("SMT_REQUESTOR_AUTH_ID (DUNS) is required for SMT agreements.");
}

const ALLOWED_AGREEMENT_DURATIONS: ReadonlyArray<
  1 | 3 | 6 | 9 | 12 | 24 | 36
> = [1, 3, 6, 9, 12, 24, 36] as const;

type NewAgreementPayload = {
  trans_id: string;
  requestorID: string;
  requesterAuthenticationID: string;
  retailCustomerEmail: string;
  agreementDuration: 1 | 3 | 6 | 9 | 12 | 24 | 36;
  customerLanguagePreference: string;
  customerMeterList: Array<{
    ESIID: string;
    meterNumber: string;
    PUCTRORNumber: number;
  }>;
  SMTTermsandConditions: "Y";
};

type ReportFormat = "LSE" | "CSV" | "JSON" | "XML";
type DataType = "DAILY" | "INTERVAL" | "MONTHLY";
type DeliveryMode = "FTP" | "EML" | "API";
type NewSubscriptionPayload = {
  trans_id: string;
  requestorID: string;
  requesterType: "CSP";
  requesterAuthenticationID: string;
  subscriptionType: "CSPENROLL" | "SCHEDULE" | "SCHEDULES" | "REPENROLL";
  historicalSubscriptionDuration: number;
  reportFormat: ReportFormat;
  dataType: DataType;
  deliveryMode: DeliveryMode;
  SMTTermsandConditions: "Y";
};

function resolveAgreementDuration(monthsBack: number): 1 | 3 | 6 | 9 | 12 | 24 | 36 {
  const normalized = Math.max(1, Math.round(monthsBack || 12));
  let chosen: 1 | 3 | 6 | 9 | 12 | 24 | 36 = 12;
  let smallestDiff = Number.POSITIVE_INFINITY;
  for (const candidate of ALLOWED_AGREEMENT_DURATIONS) {
    const diff = Math.abs(candidate - normalized);
    if (diff < smallestDiff) {
      smallestDiff = diff;
      chosen = candidate;
    }
  }
  return chosen;
}

function resolveSubscriptionDuration(monthsBack: number): 3 | 6 | 9 | 12 | 24 {
  const allowed: Array<3 | 6 | 9 | 12 | 24> = [3, 6, 9, 12, 24];
  const normalized = Math.max(3, Math.round(monthsBack || 12));
  let chosen: 3 | 6 | 9 | 12 | 24 = 12;
  let smallestDiff = Number.POSITIVE_INFINITY;
  for (const candidate of allowed) {
    const diff = Math.abs(candidate - normalized);
    if (diff < smallestDiff) {
      smallestDiff = diff;
      chosen = candidate;
    }
  }
  return chosen;
}

function mapTdspToPuctRorNumber(tdspCode?: string | null): number {
  switch ((tdspCode || "").toUpperCase()) {
    case "CENTERPOINT":
    case "CENTERPOINT_ENERGY":
    case "CENTERPOINT ENERGY":
      return 10007;
    case "ONCOR":
    case "ONCOR_ELECTRIC_DELIVERY":
      return 10004;
    case "AEP_CENTRAL":
    case "AEP_TEXAS_CENTRAL":
      return 10005;
    case "AEP_NORTH":
    case "AEP_TEXAS_NORTH":
      return 10002;
    case "TNMP":
      return 10006;
    default:
      return 0;
  }
}

function buildNewAgreementPayload(
  input: {
    esiid: string;
    meterNumber: string;
    puctRorNumber: number;
    customerEmail: string;
    agreementDurationMonths: number;
  },
): NewAgreementPayload {
  const esiid = normalizeEsiid(input.esiid);
  const identity = buildSmtIdentity();
  const PUCT_ROR_NUMBER = 10052; // TEMP: revert to known-good Just Energy REP
  return {
    trans_id: buildTransId(),
    requestorID: identity.requestorID,
    requesterAuthenticationID: identity.requesterAuthenticationID,
    retailCustomerEmail: input.customerEmail,
    agreementDuration: resolveAgreementDuration(input.agreementDurationMonths),
    customerLanguagePreference: identity.language || "ENGLISH",
    customerMeterList: [
      {
        ESIID: esiid,
        meterNumber: input.meterNumber,
        PUCTRORNumber: PUCT_ROR_NUMBER,
      },
    ],
    SMTTermsandConditions: "Y",
  };
}

function buildNewSubscriptionPayload(
  input: {
    esiid: string;
    historicalMonthsBack: number;
    includeInterval: boolean;
  },
): NewSubscriptionPayload {
  const esiid = normalizeEsiid(input.esiid);
  const identity = buildSmtIdentity();

  const includeInterval = Boolean(input.includeInterval);
  const subscriptionDuration = resolveSubscriptionDuration(
    Math.max(1, Math.round(input.historicalMonthsBack || 12)),
  );

  const reportFormat: ReportFormat = includeInterval ? "LSE" : "CSV";
  const dataType: DataType = includeInterval ? "INTERVAL" : "MONTHLY";
  const deliveryMode: DeliveryMode = "FTP";
  const payload: NewSubscriptionPayload = {
    trans_id: buildTransId(),
    requestorID: identity.requestorID,
    requesterType: "CSP",
    requesterAuthenticationID: identity.requesterAuthenticationID,
    subscriptionType: "CSPENROLL",
    historicalSubscriptionDuration: subscriptionDuration,
    reportFormat,
    dataType,
    deliveryMode,
    SMTTermsandConditions: "Y",
  };
  return payload;
}

export async function createAgreementAndSubscription(
  payload: SmtAgreementRequest,
): Promise<SmtAgreementResult> {
  if (!SMT_AGREEMENTS_ENABLED) {
    return {
      ok: false,
      status: "disabled",
      message: "SMT agreements disabled via SMT_AGREEMENTS_ENABLED env",
    };
  }

  if (!SMT_PROXY_AGREEMENTS_URL) {
    return {
      ok: false,
      status: "error",
      message: "SMT_PROXY_AGREEMENTS_URL/SMT_PROXY_URL not configured",
    };
  }

  try {
    const monthsBack =
      typeof payload.monthsBack === "number" && !Number.isNaN(payload.monthsBack)
        ? Math.max(1, Math.round(payload.monthsBack))
        : 12;
    const includeInterval =
      payload.includeInterval === undefined || payload.includeInterval === null
        ? true
        : Boolean(payload.includeInterval);
    const includeBilling =
      payload.includeBilling === undefined || payload.includeBilling === null
        ? true
        : Boolean(payload.includeBilling);
    const tdspCode = payload.tdspCode ?? null;
    let puctRorOverride: number | undefined;
    if (payload.repPuctNumber !== null && payload.repPuctNumber !== undefined) {
      const parsed = Number(payload.repPuctNumber);
      if (!Number.isNaN(parsed)) {
        puctRorOverride = parsed;
      }
    } else {
      const envOverrideRaw = process.env.SMT_REP_PUCT_OVERRIDE?.trim();
      if (envOverrideRaw) {
        const parsed = Number.parseInt(envOverrideRaw, 10);
        if (!Number.isNaN(parsed)) {
          puctRorOverride = parsed;
        }
      }
    }

    const repPuctNumberForProxy =
      puctRorOverride !== undefined && !Number.isNaN(puctRorOverride)
        ? puctRorOverride
        : DEFAULT_REP_PUCT_NUMBER;

    const meterNumber =
      (payload.meterNumber && payload.meterNumber.trim()) ||
      (payload.customerPhone && payload.customerPhone.trim()) ||
      (tdspCode ? `${tdspCode}-MTR` : undefined) ||
      payload.esiid ||
      "METER";
    const puctRorNumber = puctRorOverride ?? mapTdspToPuctRorNumber(tdspCode);
    const customerEmail = (payload.customerEmail || "").trim();

    const agreementBody = buildNewAgreementPayload({
      esiid: payload.esiid,
      meterNumber,
      puctRorNumber,
      customerEmail,
      agreementDurationMonths: monthsBack,
    });

    const subscriptionBody = buildNewSubscriptionPayload({
      esiid: payload.esiid,
      historicalMonthsBack: monthsBack,
      includeInterval,
    });

    const steps = [
      {
        name: "NewAgreement",
        path: "/v2/NewAgreement/",
        username: SMT_USERNAME,
        serviceId: SMT_SERVICE_ID,
        body: agreementBody,
      },
      {
        name: "NewSubscription",
        path: "/v2/NewSubscription/",
        username: SMT_USERNAME,
        serviceId: SMT_SERVICE_ID,
        body: subscriptionBody,
      },
    ];

    const proxyPayload = {
      action: "create_agreement_and_subscription",
      repPuctNumber: repPuctNumberForProxy,
      steps,
      agreement: {
        name: "NewAgreement",
        body: agreementBody,
      },
      subscription: {
        name: "NewSubscription",
        body: subscriptionBody,
      },
    };

    const res = await fetch(SMT_PROXY_AGREEMENTS_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(SMT_PROXY_TOKEN
          ? { Authorization: `Bearer ${SMT_PROXY_TOKEN}` }
          : {}),
      },
      body: JSON.stringify(proxyPayload),
    });

    if (!res.ok) {
      const text = await res.text();
      return {
        ok: false,
        status: "error",
        message: `Proxy HTTP ${res.status}: ${text.slice(0, 500)}`,
      };
    }

    const json = (await res.json()) as any;

    const resultsArray = Array.isArray(json?.results) ? json.results : [];
    const agreementResult = resultsArray.find(
      (entry: any) => entry?.name === "NewAgreement",
    );
    const subscriptionResult = resultsArray.find(
      (entry: any) => entry?.name === "NewSubscription",
    );

    return {
      ok: !!json?.ok,
      agreementId:
        agreementResult?.data?.agreementId ??
        agreementResult?.data?.AgreementID ??
        undefined,
      subscriptionId:
        subscriptionResult?.data?.subscriptionId ??
        subscriptionResult?.data?.SubscriptionID ??
        undefined,
      status: json?.status ?? (json?.ok ? "active" : "error"),
      message: json?.message ?? json?.error ?? undefined,
      backfillRequestedAt: json?.backfillRequestedAt ?? undefined,
      backfillCompletedAt: json?.backfillCompletedAt ?? undefined,
    };
  } catch (err: any) {
    return {
      ok: false,
      status: "error",
      message: `Proxy call failed: ${err?.message ?? String(err)}`.slice(
        0,
        500,
      ),
    };
  }
}

// NOTE: Field names and enum values above are derived from the SMT
// Data Access Interface Guide v2. Adjust payloads as SMT validation errors
// are observed, without changing the function signature or proxy wiring.

