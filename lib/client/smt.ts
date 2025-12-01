/* eslint-disable no-console */

export interface TerminateSelfPayload {
  agreementNumber: number | string;
  retailCustomerEmail: string;
}

export interface TerminateSelfResult {
  ok: boolean;
  agreementNumber?: number | string;
  retailCustomerEmail?: string;
  result?: unknown;
  error?: string;
  message?: string;
}

/**
 * Call the customer-facing SMT terminate endpoint.
 * Intended to be used from the profile/dashboard UI.
 */
export async function terminateSmtAgreementSelf(
  payload: TerminateSelfPayload,
): Promise<TerminateSelfResult> {
  const res = await fetch('/api/smt/agreements/terminate-self', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  let json: any = null;
  try {
    json = await res.json();
  } catch {
    // ignore JSON parse failure; handled below.
  }

  if (!res.ok) {
    return {
      ok: false,
      error: json?.error ?? 'HttpError',
      message:
        json?.message ??
        `Failed to terminate SMT agreement (status ${res.status})`,
    };
  }

  return (json ?? { ok: true }) as TerminateSelfResult;
}

