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

const SMT_AGREEMENTS_ENABLED =
  process.env.SMT_AGREEMENTS_ENABLED === "true" ||
  process.env.SMT_AGREEMENTS_ENABLED === "1";

const SMT_PROXY_AGREEMENTS_URL =
  process.env.SMT_PROXY_AGREEMENTS_URL ||
  process.env.SMT_PROXY_URL ||
  "";

const SMT_PROXY_TOKEN = process.env.SMT_PROXY_TOKEN || "";

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
    const agreementBody = {
      esiid: payload.esiid,
      serviceAddress: payload.serviceAddress,
      customerName: payload.customerName ?? null,
      customerEmail: payload.customerEmail ?? null,
      customerPhone: payload.customerPhone ?? null,
    };

    const subscriptionBody = {
      esiid: payload.esiid,
      serviceAddress: payload.serviceAddress,
      customerName: payload.customerName ?? null,
      customerEmail: payload.customerEmail ?? null,
      customerPhone: payload.customerPhone ?? null,
    };

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
          ? { authorization: `Bearer ${SMT_PROXY_TOKEN}` }
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

