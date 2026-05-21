import { prisma } from "@/lib/db";
import {
  canonicalCoverageWindowUtcBounds,
  resolveCanonicalUsage365CoverageWindow,
} from "@/lib/usage/canonicalMetadataWindow";

export type SmtCanonicalFetchWindow = {
  cutoff: Date;
  end: Date;
  startDate: string;
  endDate: string;
};

export async function resolveSmtCanonicalFetchWindow(esiid: string): Promise<SmtCanonicalFetchWindow | null> {
  const normalized = String(esiid ?? "").trim();
  if (!normalized) return null;
  const window = resolveCanonicalUsage365CoverageWindow();
  const { rangeStart, rangeEndInclusive } = canonicalCoverageWindowUtcBounds(window);
  const hasRows = await prisma.smtInterval.findFirst({
    where: { esiid: normalized, ts: { gte: rangeStart, lte: rangeEndInclusive } },
    orderBy: { ts: "desc" },
    select: { ts: true },
  });
  if (!hasRows?.ts) return null;
  return {
    cutoff: rangeStart,
    end: rangeEndInclusive,
    startDate: window.startDate,
    endDate: window.endDate,
  };
}

/** True when any SMT interval exists in the shared canonical 365-day window. */
export async function hasSmtIntervalsInCanonicalWindow(esiid: string | null | undefined): Promise<boolean> {
  const normalized = String(esiid ?? "").trim();
  if (!normalized) return false;
  return (await resolveSmtCanonicalFetchWindow(normalized)) != null;
}
