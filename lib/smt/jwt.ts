import 'server-only';
import { getSmtAccessToken as fetchToken, getSmtTokenMeta } from './token';

export async function getSmtAccessToken(): Promise<string> {
  return fetchToken();
}

export async function getSmtAccessTokenWithMeta(): Promise<{
  token: string;
  expiresAt: number;
  expiresAtIso: string;
  fromCache: boolean;
  remainingSec: number;
  rawExpiresInSec: number;
  tokenType?: string | null;
}> {
  const meta = await getSmtTokenMeta();
  const expiresAtSec = Math.floor(meta.expiresAtMs / 1000);

  return {
    token: meta.token,
    expiresAt: expiresAtSec,
    expiresAtIso: meta.expiresAtIso,
    fromCache: meta.fromCache,
    remainingSec: meta.remainingSec,
    rawExpiresInSec: meta.rawExpiresInSec,
    tokenType: meta.tokenType,
  };
}
