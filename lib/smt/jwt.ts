import 'server-only';

type SmtJwtConfig = {
  tokenUrl: string;
  clientId: string;
  clientSecret: string;
  audience?: string;
  scope?: string;
  cacheTtlSec?: number;
};

type CachedToken = {
  token: string;
  expiresAt: number; // epoch seconds when considered expired (post safety buffer)
  rawExpiresInSec: number;
  tokenType?: string;
};

let cached: CachedToken | null = null;

function readConfig(): SmtJwtConfig {
  const tokenUrl = (process.env.SMT_JWT_TOKEN_URL ?? '').trim();
  const clientId = (process.env.SMT_JWT_CLIENT_ID ?? '').trim();
  const clientSecret = (process.env.SMT_JWT_CLIENT_SECRET ?? '').trim();
  const audience = (process.env.SMT_JWT_AUDIENCE ?? '').trim() || undefined;
  const scope = (process.env.SMT_JWT_SCOPE ?? '').trim() || undefined;

  if (!tokenUrl || !clientId || !clientSecret) {
    const missing: string[] = [];
    if (!tokenUrl) missing.push('SMT_JWT_TOKEN_URL');
    if (!clientId) missing.push('SMT_JWT_CLIENT_ID');
    if (!clientSecret) missing.push('SMT_JWT_CLIENT_SECRET');
    throw new Error(`SMT JWT config missing: ${missing.join(', ')}`);
  }

  let cacheTtlSec: number | undefined;
  const rawTtl = (process.env.SMT_JWT_CACHE_TTL_SEC ?? '').trim();
  if (rawTtl) {
    const ttl = Number(rawTtl);
    if (!Number.isNaN(ttl) && ttl > 0) {
      cacheTtlSec = ttl;
    }
  }

  return { tokenUrl, clientId, clientSecret, audience, scope, cacheTtlSec };
}

async function fetchNewToken(nowSec: number): Promise<CachedToken> {
  const cfg = readConfig();

  const params = new URLSearchParams();
  params.set('grant_type', 'client_credentials');
  params.set('client_id', cfg.clientId);
  params.set('client_secret', cfg.clientSecret);
  if (cfg.audience) params.set('audience', cfg.audience);
  if (cfg.scope) params.set('scope', cfg.scope);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);

  let res: Response;
  try {
    res = await fetch(cfg.tokenUrl, {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        accept: 'application/json',
      },
      body: params.toString(),
      signal: controller.signal as AbortSignal,
      cache: 'no-store',
    });
  } catch (err: any) {
    throw new Error(`SMT token request failed: ${err?.message || String(err)}`);
  } finally {
    clearTimeout(timeout);
  }

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`SMT token request failed ${res.status}: ${text.slice(0, 500)}`);
  }

  let json: any;
  try {
    json = await res.json();
  } catch (err) {
    throw new Error(`SMT token response was not JSON: ${String(err)}`);
  }

  const token: string | undefined = json?.access_token ?? json?.token ?? json?.id_token;
  if (!token) {
    throw new Error('SMT token response missing access_token/token field');
  }

  const tokenType: string | undefined =
    typeof json?.token_type === 'string' && json.token_type.length > 0 ? json.token_type : undefined;

  const cfgFallback = cfg.cacheTtlSec && cfg.cacheTtlSec > 0 ? cfg.cacheTtlSec : undefined;
  const rawExpiresIn =
    typeof json?.expires_in === 'number' && json.expires_in > 0
      ? json.expires_in
      : cfgFallback ?? 2700;

  const safety = Math.min(60, Math.floor(rawExpiresIn / 10));
  const effectiveLifetime = Math.max(30, rawExpiresIn - safety);
  const expiresAt = nowSec + effectiveLifetime;

  return {
    token,
    expiresAt,
    rawExpiresInSec: rawExpiresIn,
    tokenType,
  };
}

export async function getSmtAccessToken(): Promise<string> {
  const nowSec = Math.floor(Date.now() / 1000);
  if (cached && nowSec < cached.expiresAt) {
    return cached.token;
  }

  const fresh = await fetchNewToken(nowSec);
  cached = fresh;
  return fresh.token;
}

export async function getSmtAccessTokenWithMeta(): Promise<{
  token: string;
  expiresAt: number;
  expiresAtIso: string;
  fromCache: boolean;
  remainingSec: number;
  rawExpiresInSec: number;
  tokenType?: string;
}> {
  const nowSec = Math.floor(Date.now() / 1000);

  if (cached && nowSec < cached.expiresAt) {
    const remaining = Math.max(0, cached.expiresAt - nowSec);
    return {
      token: cached.token,
      expiresAt: cached.expiresAt,
      expiresAtIso: new Date(cached.expiresAt * 1000).toISOString(),
      fromCache: true,
      remainingSec: remaining,
      rawExpiresInSec: cached.rawExpiresInSec,
      tokenType: cached.tokenType,
    };
  }

  const fresh = await fetchNewToken(nowSec);
  cached = fresh;

  return {
    token: fresh.token,
    expiresAt: fresh.expiresAt,
    expiresAtIso: new Date(fresh.expiresAt * 1000).toISOString(),
    fromCache: false,
    remainingSec: Math.max(0, fresh.expiresAt - nowSec),
    rawExpiresInSec: fresh.rawExpiresInSec,
    tokenType: fresh.tokenType,
  };
}

