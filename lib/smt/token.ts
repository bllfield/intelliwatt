import 'server-only';

type SmtTokenResponse = {
  statusCode: number;
  accessToken: string;
  tokenType: string;
  expiresIn: string;
  issuedAt: string;
  expiresAt: string;
};

type TokenMeta = {
  token: string;
  tokenType: string | null;
  issuedAtIso: string | null;
  expiresAtIso: string;
  expiresAtMs: number;
  rawExpiresInSec: number;
  remainingSec: number;
  fromCache: boolean;
  raw: SmtTokenResponse;
};

let cached: { meta: TokenMeta; cachedAtMs: number } | null = null;

function getBaseUrl(): string {
  const base = process.env.SMT_API_BASE_URL?.trim() || 'https://services.smartmetertexas.net';
  return base.replace(/\/+$/, '');
}

function getCredentials(): { username: string; password: string } {
  const username = process.env.SMT_USERNAME?.trim();
  const password = process.env.SMT_PASSWORD?.trim();
  if (!username || !password) {
    throw new Error('SMT token configuration missing SMT_USERNAME and/or SMT_PASSWORD.');
  }
  return { username, password };
}

function computeExpiry(nowMs: number, data: SmtTokenResponse): { expiresAtMs: number; ttlSec: number } {
  const ttlSec = Number(data.expiresIn ?? '3600');
  const ttlMs = Number.isFinite(ttlSec) && ttlSec > 0 ? ttlSec * 1000 : 3600_000;

  const parsedExpiresAt = Date.parse(data.expiresAt ?? '');
  if (Number.isFinite(parsedExpiresAt) && parsedExpiresAt > nowMs) {
    return { expiresAtMs: parsedExpiresAt, ttlSec: ttlSec > 0 ? ttlSec : Math.floor((parsedExpiresAt - nowMs) / 1000) };
  }

  return { expiresAtMs: nowMs + ttlMs, ttlSec: ttlSec > 0 ? ttlSec : Math.floor(ttlMs / 1000) };
}

function parseXmlTag(xml: string, tag: string): string | null {
  const regex = new RegExp(`<${tag}>([^<]+)</${tag}>`, 'i');
  const match = xml.match(regex);
  return match ? match[1] : null;
}

async function fetchSoapToken(baseUrl: string, username: string, password: string): Promise<SmtTokenResponse> {
  const url = `${baseUrl}/v2/access/token/`;
  const envelope = `<?xml version="1.0" encoding="UTF-8"?>\n<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:bim="http://BIM_TokenGeneratorSOAP"><soapenv:Header/><soapenv:Body><bim:processTokenGenerator><bim:TokenGeneratorRequest><username>${username}</username><password>${password}</password></bim:TokenGeneratorRequest></bim:processTokenGenerator></soapenv:Body></soapenv:Envelope>`;

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'text/xml',
      Accept: 'text/xml',
    },
    body: envelope,
  });

  const text = await res.text();

  if (!res.ok) {
    throw new Error(`SMT SOAP token request failed (${res.status} ${res.statusText}): ${text.slice(0, 500)}`);
  }

  const statusCode = parseInt(parseXmlTag(text, 'statusCode') || '0', 10);
  const accessToken = parseXmlTag(text, 'accessToken');
  const tokenType = parseXmlTag(text, 'tokenType') || 'Bearer';
  const expiresIn = parseXmlTag(text, 'expiresIn') || '3600';
  const issuedAt = parseXmlTag(text, 'issuedAt') || '';
  const expiresAt = parseXmlTag(text, 'expiresAt') || '';

  if (!accessToken || statusCode !== 200) {
    throw new Error(`SMT SOAP token parse error: status=${statusCode} body=${text.slice(0, 500)}`);
  }

  return { statusCode, accessToken, tokenType, expiresIn, issuedAt, expiresAt };
}

async function fetchJsonToken(baseUrl: string, username: string, password: string): Promise<SmtTokenResponse> {
  const url = `${baseUrl}/v2/token/`;

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ username, password }),
  });

  const text = await res.text().catch(() => '');
  if (!res.ok) {
    throw new Error(`SMT token request failed (${res.status} ${res.statusText}): ${text}`);
  }

  let data: any = {};
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(`SMT token response was not JSON: ${text.slice(0, 300)}`);
  }

  if (typeof data.statusCode !== 'number' || data.statusCode !== 200 || !data.accessToken) {
    throw new Error(`SMT token response error: ${JSON.stringify(data).slice(0, 500)}`);
  }

  return {
    statusCode: data.statusCode,
    accessToken: data.accessToken,
    tokenType: data.tokenType || data.token_type || 'Bearer',
    expiresIn: data.expiresIn || data.expires_in || '3600',
    issuedAt: data.issuedAt || '',
    expiresAt: data.expiresAt || '',
  };
}

export async function getSmtTokenMeta(): Promise<TokenMeta> {
  const nowMs = Date.now();
  if (cached && cached.meta.expiresAtMs - 60_000 > nowMs) {
    const remaining = Math.max(0, Math.floor((cached.meta.expiresAtMs - nowMs) / 1000));
    return { ...cached.meta, remainingSec: remaining, fromCache: true };
  }

  const { username, password } = getCredentials();
  const baseUrl = getBaseUrl();

  // Try SOAP token endpoint first; fall back to JSON token if SOAP fails.
  let data: SmtTokenResponse;
  try {
    data = await fetchSoapToken(baseUrl, username, password);
  } catch (soapErr) {
    // Fallback to JSON token endpoint for environments still using it.
    data = await fetchJsonToken(baseUrl, username, password);
  }

  const { expiresAtMs, ttlSec } = computeExpiry(nowMs, data as SmtTokenResponse);
  const issuedAtIso =
    typeof data.issuedAt === 'string' && Date.parse(data.issuedAt) ? new Date(data.issuedAt).toISOString() : null;

  const meta: TokenMeta = {
    token: data.accessToken,
    tokenType: typeof data.tokenType === 'string' && data.tokenType.length > 0 ? data.tokenType : null,
    issuedAtIso,
    expiresAtIso: new Date(expiresAtMs).toISOString(),
    expiresAtMs,
    rawExpiresInSec: Number.isFinite(ttlSec) ? ttlSec : 3600,
    remainingSec: Math.max(0, Math.floor((expiresAtMs - nowMs) / 1000)),
    fromCache: false,
    raw: data as SmtTokenResponse,
  };

  cached = { meta, cachedAtMs: nowMs };
  return meta;
}

export async function getSmtAccessToken(): Promise<string> {
  const meta = await getSmtTokenMeta();
  return meta.token;
}

