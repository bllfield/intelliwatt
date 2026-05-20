import type { NextRequest } from "next/server";

const USAGE_SESSION_HEADER = "x-usage-session-key";
const USAGE_SESSION_COOKIE = "intelliwatt_usage_session";

export function resolveUserUsageSessionKey(args: {
  userId: string;
  request?: NextRequest | null;
  cookieValue?: string | null;
}): string {
  const fromHeader = args.request?.headers.get(USAGE_SESSION_HEADER)?.trim();
  if (fromHeader) return fromHeader;

  const fromCookie = String(args.cookieValue ?? "").trim();
  if (fromCookie) return fromCookie;

  return `visit:${args.userId}`;
}

export const USER_USAGE_SESSION_HEADER = USAGE_SESSION_HEADER;
export const USER_USAGE_SESSION_COOKIE = USAGE_SESSION_COOKIE;
