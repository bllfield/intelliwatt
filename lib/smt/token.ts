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

export async function getSmtTokenMeta(): Promise<TokenMeta> {
  const nowMs = Date.now();
  if (cached && cached.meta.expiresAtMs - 60_000 > nowMs) {
    const remaining = Math.max(0, Math.floor((cached.meta.expiresAtMs - nowMs) / 1000));
    return { ...cached.meta, remainingSec: remaining, fromCache: true };
  }

  const { username, password } = getCredentials();
  const url = `${getBaseUrl()}/v2/token/`;

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ username, password }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`SMT token request failed (${res.status} ${res.statusText}): ${text}`);
  }

  const data = (await res.json()) as Partial<SmtTokenResponse>;

  if (typeof data.statusCode !== 'number' || data.statusCode !== 200) {
    throw new Error(`SMT token response error: ${JSON.stringify(data)}`);
  }

  if (!data.accessToken) {
    throw new Error(`SMT token response missing accessToken: ${JSON.stringify(data)}`);
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

