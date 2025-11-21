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

// Default language preference for SMT notifications.
const SMT_LANG_DEFAULT = (process.env.SMT_LANG_DEFAULT || "en").trim() || "en";

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

type AgreementPayloadInput = {
  esiid: string;
  serviceAddress: string;
  customerName?: string | null;
  customerEmail?: string | null;
  customerPhone?: string | null;
  tdspCode?: string | null;
  monthsBack: number;
  includeInterval: boolean;
  includeBilling: boolean;
};

type SubscriptionPayloadInput = {
  esiid: string;
  tdspCode?: string | null;
  monthsBack: number;
  includeInterval: boolean;
  includeBilling: boolean;
};

function buildNewAgreementPayload(
  input: AgreementPayloadInput,
): Record<string, any> {
  const esiid = normalizeEsiid(input.esiid);
  const identity = buildSmtIdentity();
  const header = {
    ...identity,
    trans_id: buildTransId(),
  };

  const customerMeterRecord = {
    ESIID: esiid,
    meterNumber: esiid,
    PUCTRORNumber: "10004",
    serviceAddress: input.serviceAddress,
  };

  const request: Record<string, any> = {
    esiid,
    tdspCode: input.tdspCode ?? null,
    serviceAddress: input.serviceAddress,
    includeInterval: input.includeInterval,
    includeBilling: input.includeBilling,
    monthsBack: input.monthsBack,
    agreementDuration: input.monthsBack,
    SMTTermsandConditions: "Y",
    requestorType: "CSP",
    userType: "CSP",
    customerMeterList: [customerMeterRecord],
    retailCustomerEmail: input.customerEmail ?? null,
    customerLanguagePreference: identity.language,
  };

  if (input.customerName) {
    request.customerName = input.customerName;
  }
  if (input.customerPhone) {
    request.customerPhone = input.customerPhone;
  }

  return {
    NewAgreement: {
      header,
      request,
      trans_id: header.trans_id,
      requestorID: identity.requestorID,
      requesterAuthenticationID: identity.requesterAuthenticationID,
      serviceID: identity.serviceID,
      username: identity.username,
      language: identity.language,
    },
  };
}

function buildNewSubscriptionPayload(
  input: SubscriptionPayloadInput,
): Record<string, any> {
  const esiid = normalizeEsiid(input.esiid);
  const identity = buildSmtIdentity();
  const header = {
    ...identity,
    trans_id: buildTransId(),
  };

  const months = Math.max(1, Math.round(input.monthsBack));
  const start = new Date();
  start.setMonth(start.getMonth() - months);

  const formatMMDDYYYY = (d: Date): string => {
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const dd = String(d.getDate()).padStart(2, "0");
    const yyyy = d.getFullYear();
    return `${mm}/${dd}/${yyyy}`;
  };

  const customerMeterRecord = {
    ESIID: esiid,
    meterNumber: esiid,
  };

  const request = {
    esiid,
    tdspCode: input.tdspCode ?? null,
    includeInterval: input.includeInterval,
    includeBilling: input.includeBilling,
    SMTTermsandConditions: "Y",
    requestorType: "CSP",
    userType: "CSP",
    dataType: "HML",
    startDate: formatMMDDYYYY(start),
    endDate: null,
    customerMeterList: [customerMeterRecord],
  };

  return {
    NewSubscription: {
      header,
      request,
      trans_id: header.trans_id,
      requestorID: identity.requestorID,
      requesterAuthenticationID: identity.requesterAuthenticationID,
      serviceID: identity.serviceID,
      username: identity.username,
      language: identity.language,
    },
  };
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

    const agreementBody = buildNewAgreementPayload({
      esiid: payload.esiid,
      serviceAddress: payload.serviceAddress,
      customerName: payload.customerName ?? null,
      customerEmail: payload.customerEmail ?? null,
      customerPhone: payload.customerPhone ?? null,
      tdspCode,
      monthsBack,
      includeInterval,
      includeBilling,
    });
    const subscriptionBody = buildNewSubscriptionPayload({
      esiid: payload.esiid,
      tdspCode,
      monthsBack,
      includeInterval,
      includeBilling,
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

