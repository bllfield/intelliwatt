// lib/ercot/auth.ts

/**
 * ERCOT Public API auth — obtain ID token via ROPC flow.
 * Docs (summarized from your pasted page):
 *  POST https://ercotb2c.b2clogin.com/ercotb2c.onmicrosoft.com/B2C_1_PUBAPI-ROPC-FLOW/oauth2/v2.0/token
 *  Query/body fields:
 *    username, password, grant_type=password,
 *    scope=openid+fec253ea-0d06-4272-a5e6-b478baeecd70+offline_access,
 *    client_id=fec253ea-0d06-4272-a5e6-b478baeecd70,
 *    response_type=id_token
 *
 * We request a fresh id_token on each cron run (tokens expire ~1 hour).
 */
const TOKEN_URL =
  process.env.ERCOT_TOKEN_URL ||
  'https://ercotb2c.b2clogin.com/ercotb2c.onmicrosoft.com/B2C_1_PUBAPI-ROPC-FLOW/oauth2/v2.0/token';

const CLIENT_ID =
  process.env.ERCOT_CLIENT_ID || 'fec253ea-0d06-4272-a5e6-b478baeecd70';

const SCOPE =
  process.env.ERCOT_SCOPE || 'openid fec253ea-0d06-4272-a5e6-b478baeecd70 offline_access';

type TokenResp = {
  id_token?: string;
  token_type?: string;
  expires_in?: number;
  error?: string;
  error_description?: string;
};

export async function getErcotIdToken(): Promise<string> {
  // If user supplied a token manually (rare), allow it.
  if (process.env.ERCOT_ID_TOKEN) {
    return process.env.ERCOT_ID_TOKEN;
  }

  const username = process.env.ERCOT_USERNAME;
  const password = process.env.ERCOT_PASSWORD;
  if (!username || !password) {
    throw new Error('Missing ERCOT_USERNAME or ERCOT_PASSWORD env (required to auto-fetch id_token)');
  }

  // ERCOT examples show token params either as querystring or body. We'll send as form body.
  // Azure AD B2C expects space-separated scopes (not plus-separated)
  // Ensure 'openid' is included (required when response_type=id_token)
  const scopeValue = SCOPE.includes('openid') ? SCOPE : `openid ${SCOPE}`;
  const form = new URLSearchParams();
  form.set('username', username);
  form.set('password', password);
  form.set('grant_type', 'password');
  form.set('scope', scopeValue);
  form.set('client_id', CLIENT_ID);
  form.set('response_type', 'id_token');

  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: form.toString(),
    cache: 'no-store',
  });

  const json = (await res.json()) as TokenResp;
  if (!res.ok || !json.id_token) {
    const detail = json.error_description || json.error || (await res.text());
    throw new Error(`ERCOT token fetch failed: ${res.status} ${detail}`);
  }

  return json.id_token;
}
