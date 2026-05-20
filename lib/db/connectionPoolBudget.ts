/**
 * Prisma serverless pool helpers. Vercel routes often configure
 * `connection_limit=1` per datasource URL; a single request that touches
 * both DATABASE_URL and USAGE_DATABASE_URL needs two slots at once.
 */

export function parseConnectionLimitFromUrl(rawUrl: string | undefined): number | null {
  const value = String(rawUrl ?? "").trim();
  if (!value) return null;
  try {
    const parsed = Number(new URL(value).searchParams.get("connection_limit") ?? "");
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
  } catch {
    return null;
  }
}

export function countConfiguredDatasourceUrls(urls: Array<string | undefined>): number {
  return urls.filter((u) => String(u ?? "").trim().length > 0).length;
}

/** True when inline heavy DB work should defer to cron/queue (pool too small for concurrent datasources). */
export function shouldDeferHeavyDbWorkForPool(args?: {
  datasourceUrls?: Array<string | undefined>;
}): boolean {
  const datasourceUrls =
    args?.datasourceUrls ??
    [process.env.DATABASE_URL, process.env.USAGE_DATABASE_URL];
  const datasourceCount = countConfiguredDatasourceUrls(datasourceUrls);
  if (datasourceCount === 0) return false;

  const limits = datasourceUrls
    .map(parseConnectionLimitFromUrl)
    .filter((v): v is number => typeof v === "number" && Number.isFinite(v));
  if (limits.length === 0) return false;

  const minLimit = Math.min(...limits);
  return minLimit <= 1 || minLimit < datasourceCount;
}
