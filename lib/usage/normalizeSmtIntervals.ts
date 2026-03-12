import { Prisma } from "@prisma/client";
import { DateTime } from "luxon";
import { prisma } from "@/lib/db";
import { usagePrisma } from "@/lib/db/usageClient";
import { normalizeSmtTo15Min, type NormalizeOpts, type SmtAdhocRow } from "@/lib/analysis/normalizeSmt";
import { dualWriteUsageIntervals, type UsageIntervalCreateInput } from "@/lib/usage/dualWriteUsageIntervals";

export const RAW_MODEL_CANDIDATES = [
  "rawSmtRow",
  "rawSmtRows",
  "rawSmtFile",
  "rawSmtFiles",
  "smtRawRow",
  "smtRawRows",
] as const;

type RawDao = {
  findMany: (args: any) => Promise<any[]>;
};

export type SmtWritablePoint = {
  ts: string;
  kwh: number;
  filled?: boolean;
  esiid: string;
  meter: string;
  source?: string;
};

export type SmtNormalizedIntervalInput = {
  esiid: string;
  meter: string;
  ts: Date;
  kwh: number;
  source?: string | null;
};

export async function persistParsedNormalizedSmtIntervals(args: {
  intervals: Array<{ esiid: string; meter: string; ts: Date; kwh: number; source?: string | null }>;
}): Promise<{ records: number }> {
  const rows: UsageIntervalCreateInput[] = (args.intervals ?? []).map((interval) => ({
    esiid: String(interval.esiid ?? "").trim(),
    meter: String(interval.meter ?? "").trim(),
    ts: interval.ts instanceof Date ? interval.ts : new Date(interval.ts),
    kwh: new Prisma.Decimal(Number(interval.kwh) || 0),
    source: String(interval.source ?? "smt-inline"),
  }));
  await dualWriteUsageIntervals(rows);
  return { records: rows.length };
}

export async function getSmtRawDao(): Promise<RawDao | null> {
  for (const name of RAW_MODEL_CANDIDATES) {
    if ((prisma as any)[name]?.findMany) return (prisma as any)[name] as RawDao;
  }
  return null;
}

export async function loadSmtRawRows(args: {
  esiid?: string;
  meter?: string;
  from?: string;
  to?: string;
  take?: number;
}): Promise<{ rows: any[]; modelName: string | null }> {
  const dao = await getSmtRawDao();
  if (!dao) return { rows: [], modelName: null };
  const where: Record<string, unknown> = {};
  if (args.esiid) where.esiid = args.esiid;
  if (args.meter) where.meter = args.meter;
  if (args.from || args.to) {
    const createdAt: Record<string, Date> = {};
    if (args.from) createdAt.gte = new Date(args.from);
    if (args.to) createdAt.lte = new Date(args.to);
    where.createdAt = createdAt;
  }
  const rows = await dao.findMany({
    where: Object.keys(where).length ? where : undefined,
    orderBy: { id: "asc" },
    take: Math.max(1, Math.min(50000, Number(args.take) || 5000)),
  });
  return { rows, modelName: "dynamic_raw_model" };
}

export async function normalizeAndPersistSmtIntervals(args: {
  rows: Array<SmtAdhocRow>;
  esiid?: string;
  meter?: string;
  normalizeOpts?: NormalizeOpts;
  saveFilled?: boolean;
  source?: string;
  filterLocalDate?: { date: string; timezone: string };
}): Promise<{
  processedRows: number;
  normalizedPoints: number;
  consideredPoints: number;
  persisted: number;
  skippedNoIdentifiers: number;
  skippedSaveFilled: number;
  skippedRealProtected: number;
  sample: Array<{ ts: string; kwh: number; filled: boolean; esiid: string; meter: string; source: string }>;
}> {
  const processedRows = Array.isArray(args.rows) ? args.rows.length : 0;
  const normalizeOpts = args.normalizeOpts ?? {};
  const source = String(args.source ?? "smt");
  const saveFilled = args.saveFilled !== false;

  const shaped = (args.rows ?? []).map((r: any) => ({
    esiid: r?.esiid ?? args.esiid,
    meter: r?.meter ?? args.meter,
    timestamp: r?.timestamp ?? r?.end ?? undefined,
    kwh: r?.kwh ?? r?.value ?? undefined,
    start: r?.start ?? undefined,
    end: r?.end ?? undefined,
  }));

  const normalized = normalizeSmtTo15Min(shaped as Array<SmtAdhocRow>, normalizeOpts).map((p) => ({
    ts: p.ts,
    kwh: Number(p.kwh) || 0,
    filled: p.filled ?? (Number(p.kwh) === 0),
    esiid: String(args.esiid ?? shaped[0]?.esiid ?? "unknown"),
    meter: String(args.meter ?? shaped[0]?.meter ?? "unknown"),
    source,
  }));

  const filtered: SmtWritablePoint[] = [];
  for (const p of normalized) {
    if (args.filterLocalDate) {
      const localDate = DateTime.fromISO(p.ts).setZone(args.filterLocalDate.timezone).toISODate();
      if (localDate !== args.filterLocalDate.date) continue;
    }
    filtered.push(p);
  }

  const persistedOut = await persistNormalizedSmtPoints({
    points: filtered,
    saveFilled,
  });

  return {
    processedRows,
    normalizedPoints: normalized.length,
    consideredPoints: filtered.length,
    ...persistedOut,
    sample: normalized.slice(0, 50),
  };
}

export async function persistNormalizedSmtPoints(args: {
  points: SmtWritablePoint[];
  saveFilled?: boolean;
}): Promise<{
  persisted: number;
  skippedNoIdentifiers: number;
  skippedSaveFilled: number;
  skippedRealProtected: number;
}> {
  const saveFilled = args.saveFilled !== false;

  let persisted = 0;
  let skippedNoIdentifiers = 0;
  let skippedSaveFilled = 0;
  let skippedRealProtected = 0;

  for (const p of args.points ?? []) {
    if (!p.esiid || !p.meter) {
      skippedNoIdentifiers++;
      continue;
    }
    if (!saveFilled && p.filled) {
      skippedSaveFilled++;
      continue;
    }

    const key = { esiid_meter_ts: { esiid: p.esiid, meter: p.meter, ts: new Date(p.ts) } };
    const existing = await prisma.smtInterval.findUnique({ where: key });

    if (!existing) {
      try {
        await prisma.smtInterval.create({
          data: {
            esiid: p.esiid,
            meter: p.meter,
            ts: new Date(p.ts),
            kwh: p.kwh,
            filled: !!p.filled,
            source: p.source,
          },
        });
        persisted++;
      } catch (err) {
        if (!(err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002")) {
          throw err;
        }
      }
      continue;
    }

    const isExistingReal = existing.filled === false;
    const isIncomingReal = p.filled === false;
    if (isExistingReal && !isIncomingReal) {
      skippedRealProtected++;
      continue;
    }

    await prisma.smtInterval.update({
      where: key,
      data: {
        kwh: p.kwh,
        filled: isIncomingReal ? false : existing.filled,
        source: p.source ?? existing.source ?? "smt",
      },
    });
    persisted++;
  }

  return {
    persisted,
    skippedNoIdentifiers,
    skippedSaveFilled,
    skippedRealProtected,
  };
}

export async function replaceNormalizedSmtIntervals(args: {
  intervals: SmtNormalizedIntervalInput[];
  transactionTimeoutMs?: number;
  writeUsageModule?: boolean;
  usageChunkSize?: number;
  primaryChunkSize?: number;
}): Promise<{
  inserted: number;
  skipped: number;
  records: number;
  distinctEsiids: string[];
}> {
  const records = Array.isArray(args.intervals) ? args.intervals.length : 0;
  if (!records) return { inserted: 0, skipped: 0, records: 0, distinctEsiids: [] };

  const primaryChunkSize = Math.max(1, Number(args.primaryChunkSize) || 4000);
  const usageChunkSize = Math.max(1, Number(args.usageChunkSize) || 5000);
  const timeout = Math.max(5000, Number(args.transactionTimeoutMs) || 30000);

  const byPair = new Map<
    string,
    { esiid: string; meter: string; minTsMs: number; maxTsMs: number; rows: Array<{ esiid: string; meter: string; ts: Date; kwh: Prisma.Decimal; source: string }> }
  >();
  for (const interval of args.intervals) {
    const esiid = String(interval.esiid ?? "").trim();
    const meter = String(interval.meter ?? "").trim();
    const ts = interval.ts instanceof Date ? interval.ts : new Date(interval.ts);
    if (!esiid || !meter || !Number.isFinite(ts.getTime())) continue;
    const key = `${esiid}|${meter}`;
    const tsMs = ts.getTime();
    const row = {
      esiid,
      meter,
      ts,
      kwh: new Prisma.Decimal(Number(interval.kwh) || 0),
      source: String(interval.source ?? "smt"),
    };
    const existing = byPair.get(key);
    if (!existing) {
      byPair.set(key, { esiid, meter, minTsMs: tsMs, maxTsMs: tsMs, rows: [row] });
    } else {
      existing.rows.push(row);
      if (tsMs < existing.minTsMs) existing.minTsMs = tsMs;
      if (tsMs > existing.maxTsMs) existing.maxTsMs = tsMs;
    }
  }

  const pairs = Array.from(byPair.values());
  let inserted = 0;
  await prisma.$transaction(
    async (tx) => {
      for (const pair of pairs) {
        if (!pair.rows.length) continue;
        await tx.smtInterval.deleteMany({
          where: {
            esiid: pair.esiid,
            meter: pair.meter,
            ts: { gte: new Date(pair.minTsMs), lte: new Date(pair.maxTsMs) },
          },
        });
      }
      for (const pair of pairs) {
        if (!pair.rows.length) continue;
        for (let i = 0; i < pair.rows.length; i += primaryChunkSize) {
          const chunk = pair.rows.slice(i, i + primaryChunkSize);
          const result = await tx.smtInterval.createMany({
            data: chunk,
            skipDuplicates: false,
          });
          inserted += Number(result?.count ?? 0);
        }
      }
    },
    { timeout }
  );

  if (args.writeUsageModule !== false) {
    try {
      const usageClient: any = usagePrisma;
      if (usageClient?.usageIntervalModule) {
        for (const pair of pairs) {
          if (!pair.rows.length) continue;
          const minDate = new Date(pair.minTsMs);
          const maxDate = new Date(pair.maxTsMs);
          await usageClient.usageIntervalModule.deleteMany({
            where: {
              esiid: pair.esiid,
              meter: pair.meter,
              ts: { gte: minDate, lte: maxDate },
            },
          });
          const usageRows = pair.rows.map((r) => ({
            esiid: r.esiid,
            meter: r.meter,
            ts: r.ts,
            kwh: r.kwh,
            filled: false,
            source: r.source,
          }));
          for (let i = 0; i < usageRows.length; i += usageChunkSize) {
            await usageClient.usageIntervalModule.createMany({
              data: usageRows.slice(i, i + usageChunkSize),
              skipDuplicates: true,
            });
          }
        }
      }
    } catch (usageErr) {
      console.error("[normalizeSmtIntervals] usage dual-write failed", usageErr);
    }
  }

  const distinctEsiids = Array.from(new Set(pairs.map((p) => p.esiid))).filter(Boolean);
  return {
    inserted,
    skipped: Math.max(0, records - inserted),
    records,
    distinctEsiids,
  };
}
