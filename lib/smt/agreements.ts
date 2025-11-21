export type SmtAgreementRequest = {
  esiid: string;
  serviceAddress: string;
  customerName?: string | null;
  customerEmail?: string | null;
  customerPhone?: string | null;
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
const SMT_REQUESTOR_ID =
  process.env.SMT_REQUESTOR_ID || process.env.SMT_USERNAME || "";

const SMT_REQUESTOR_AUTH_ID = process.env.SMT_REQUESTOR_AUTH_ID || "";

// SMT API Service ID created in the SMT portal. If not explicitly set,
// we fall back to SMT_USERNAME (the API username used for /v2/token/).
const SMT_SERVICE_ID =
  process.env.SMT_SERVICE_ID || process.env.SMT_USERNAME || "";

// Default language preference for SMT notifications.
const SMT_LANG_DEFAULT = process.env.SMT_LANG_DEFAULT || "ENGLISH";

function buildTransId(prefix: string): string {
  const rand = Math.random().toString(36).slice(2, 10);
  const ts = Date.now().toString(36);
  const base = `${prefix}-${ts}-${rand}`.replace(/[^a-zA-Z0-9]/g, "");
  return base.slice(0, 32);
}

function normalizeEsiid(esiid: string): string {
  const digits = esiid.replace(/\D/g, "");
  return digits || esiid;
}

function buildNewAgreementBody(payload: SmtAgreementRequest): any {
  const esiid = normalizeEsiid(payload.esiid);
  const transId = buildTransId("AGR");

  const customerMeterRecord: any = {
    ESIID: esiid,
    serviceAddress: payload.serviceAddress,
  };

  const NewAgreement: any = {
    trans_id: transId,
    requestorID: SMT_REQUESTOR_ID,
    requestorType: "CSP",
    requestorRole: "CSP",
    requestorAuthID: SMT_REQUESTOR_AUTH_ID || undefined,
    apiServiceID: SMT_SERVICE_ID,
    SMTTermsandConditions: "Y",
    languagePreference: SMT_LANG_DEFAULT,
    customerMeterList: [customerMeterRecord],
  };

  if (payload.customerName) {
    NewAgreement.customerName = payload.customerName;
  }
  if (payload.customerEmail) {
    NewAgreement.customerEmail = payload.customerEmail;
  }
  if (payload.customerPhone) {
    NewAgreement.customerPhone = payload.customerPhone;
  }

  return { NewAgreement };
}

function buildNewSubscriptionBody(payload: SmtAgreementRequest): any {
  const esiid = normalizeEsiid(payload.esiid);
  const transId = buildTransId("SUB");

  const now = new Date();
  const start = new Date(now);
  start.setFullYear(start.getFullYear() - 1);

  const formatMMDDYYYY = (d: Date): string => {
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const dd = String(d.getDate()).padStart(2, "0");
    const yyyy = d.getFullYear();
    return `${mm}/${dd}/${yyyy}`;
  };

  const customerMeterRecord: any = {
    ESIID: esiid,
  };

  const NewSubscription: any = {
    trans_id: transId,
    requestorID: SMT_REQUESTOR_ID,
    requestorType: "CSP",
    requestorRole: "CSP",
    requestorAuthID: SMT_REQUESTOR_AUTH_ID || undefined,
    apiServiceID: SMT_SERVICE_ID,
    SMTTermsandConditions: "Y",
    dataType: "HML",
    startDate: formatMMDDYYYY(start),
    endDate: null,
    customerMeterList: [customerMeterRecord],
  };

  return { NewSubscription };
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

  const missingEnv: string[] = [];
  if (!SMT_REQUESTOR_ID) {
    missingEnv.push("SMT_REQUESTOR_ID/SMT_USERNAME");
  }
  if (!SMT_SERVICE_ID) {
    missingEnv.push("SMT_SERVICE_ID/SMT_USERNAME");
  }
  if (!SMT_REQUESTOR_AUTH_ID) {
    missingEnv.push("SMT_REQUESTOR_AUTH_ID");
  }

  if (missingEnv.length > 0) {
    return {
      ok: false,
      status: "error",
      message: `Missing SMT env: ${missingEnv.join(", ")}`,
    };
  }

  try {
    const agreementBody = buildNewAgreementBody(payload);
    const subscriptionBody = buildNewSubscriptionBody(payload);

    const proxyPayload = {
      action: "create_agreement_and_subscription",
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

