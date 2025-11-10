// lib/wattbuy/electricity.ts

import { wbGet } from './client';
import { electricityInfoParams } from './params';

type ElecParams = {
  address?: string;
  city?: string;
  state?: string; // case-insensitive
  zip: string | number;
};

function normStr(x?: string | null): string | undefined {
  if (!x) return undefined;
  const t = String(x).trim();
  if (!t) return undefined;
  // If caller pasted %20 etc, decode once to prevent double-encoding.
  try {
    if (t.includes('%')) return decodeURIComponent(t);
  } catch { /* ignore bad encodings */ }
  return t;
}

function normState(s?: string | null): string | undefined {
  const t = normStr(s);
  if (!t) return undefined;
  return t.length === 2 ? t.toUpperCase() : t; // try canonical 2-letter uppercase
}

export function electricityParams(input: ElecParams) {
  // Build *clean* params (URLSearchParams will encode once)
  return {
    address: normStr(input.address),
    city: normStr(input.city),
    state: normState(input.state),
    zip: String(input.zip ?? '').trim(),
  };
}

// Performs robust fetch with retries & alternates:
// 1) direct (state uppercase)
// 2) direct (state lowercase) if 1 fails upstream
// 3) wattkey fallback: call electricity/info, then electricity?wattkey=...
export async function getElectricityRobust(input: ElecParams) {
  const primary = electricityParams(input);
  if (!primary.zip) {
    return { ok: false as const, status: 400, error: 'zip required' };
  }

  // 1) Direct with canonical STATE=UPPER
  let res = await wbGet<any>('electricity', primary, undefined, 1);
  if (res.ok) return res;

  const upstreamErr = (res.text || '').toString().slice(0, 400);

  // 2) Try lowercase state variant if provided
  if (primary.state) {
    const lower = { ...primary, state: primary.state.toLowerCase() };
    const res2 = await wbGet<any>('electricity', lower, undefined, 1);
    if (res2.ok) return res2;
  }

  // 3) wattkey fallback (avoid address parsing issues upstream)
  //    - fetch info to obtain wattkey
  const infoParams = {
    address: primary.address,
    city: primary.city,
    state: (primary.state || '').toLowerCase(),
    zip: primary.zip,
    housing_chars: 'false',
    utility_list: 'false',
  };
  const info = await wbGet<any>('electricity/info', electricityInfoParams(infoParams), undefined, 1);
  const wattkey = info?.ok ? info?.data?.wattkey : undefined;

  if (wattkey) {
    const wkRes = await wbGet<any>('electricity', { wattkey }, undefined, 1);
    if (wkRes.ok) {
      // Surface that we used wattkey so you can see it in the inspector
      wkRes.data = wkRes.data ?? {};
      try { (wkRes.data as any).__used_wattkey = true; } catch {}
      return wkRes;
    }
  }

  // Nothing worked — return the original upstream error with context
  return {
    ok: false as const,
    status: res.status,
    data: res.data,
    text: upstreamErr || res.text,
    headers: res.headers,
  };
}

