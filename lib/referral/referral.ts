import type { ReadonlyURLSearchParams } from "next/navigation";

export const REFERRAL_QUERY_PARAM = "ref";

type SearchParamsInput =
  | URLSearchParams
  | ReadonlyURLSearchParams
  | Record<string, string | string[] | undefined>
  | undefined
  | null;

export function getReferralTokenFromSearchParams(
  searchParams?: SearchParamsInput,
): string | undefined {
  if (!searchParams) {
    return undefined;
  }

  if (typeof (searchParams as URLSearchParams).get === "function") {
    const value = (searchParams as URLSearchParams).get(REFERRAL_QUERY_PARAM);
    return value && value.trim().length > 0 ? value : undefined;
  }

  const record = searchParams as Record<string, string | string[] | undefined>;
  const raw = record[REFERRAL_QUERY_PARAM];

  if (typeof raw === "string") {
    return raw.trim().length > 0 ? raw : undefined;
  }

  if (Array.isArray(raw)) {
    const first = raw.find((entry) => typeof entry === "string" && entry.trim().length > 0);
    return first;
  }

  return undefined;
}

