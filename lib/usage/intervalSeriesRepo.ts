import { usagePrisma } from "@/lib/db/usageClient";
import { IntervalSeriesKind } from "@/modules/usageSimulator/kinds";

type IntervalInput = { tsUtc: string | Date; kwh: number | string };

/** Chunk size for intervalPoint15m writes — kept outside long interactive transactions. */
export const INTERVAL_POINT15M_PERSIST_CHUNK_SIZE = 5000;

export type IntervalSeriesPersistDiagnostics = {
  intervalRowsToPersist: number;
  intervalChunkSize: number;
  intervalChunksWritten: number;
  intervalPersistDurationMs: number;
  transactionTimeoutAvoided: true;
};

function asUtcDate(input: string | Date): Date {
  const d = input instanceof Date ? new Date(input.getTime()) : new Date(input);
  if (Number.isNaN(d.getTime())) {
    throw new Error(`Invalid interval timestamp: ${String(input)}`);
  }
  return d;
}

function assertUtc15mGrid(ts: Date): void {
  if (ts.getUTCMinutes() % 15 !== 0 || ts.getUTCSeconds() !== 0 || ts.getUTCMilliseconds() !== 0) {
    throw new Error(`Interval timestamp is off-grid (must be UTC 15-minute aligned): ${ts.toISOString()}`);
  }
}

function normalizeKwh(value: number | string): string {
  const n = typeof value === "string" ? Number(value) : value;
  if (!Number.isFinite(n)) throw new Error(`Invalid interval kWh value: ${String(value)}`);
  return n.toFixed(6);
}

export async function saveIntervalSeries15m(params: {
  userId: string;
  houseId: string;
  kind: IntervalSeriesKind;
  scenarioId?: string | null;
  anchorStartUtc: Date;
  anchorEndUtc: Date;
  derivationVersion: string;
  buildInputsHash: string;
  intervals15: IntervalInput[];
}): Promise<{ seriesId: string; diagnostics: IntervalSeriesPersistDiagnostics }> {
  const scenarioId = params.scenarioId ?? null;
  const intervals = params.intervals15 ?? [];
  if (!intervals.length) throw new Error("intervals15 must contain at least one interval");

  const prepared = intervals.map((row) => {
    const tsUtc = asUtcDate(row.tsUtc);
    assertUtc15mGrid(tsUtc);
    return {
      tsUtc,
      kwh: normalizeKwh(row.kwh),
    };
  });

  const persistStartedAt = Date.now();
  const chunkSize = INTERVAL_POINT15M_PERSIST_CHUNK_SIZE;

  const seriesId = await usagePrisma.$transaction(
    async (tx) => {
      const existing = await (tx as any).intervalSeries.findFirst({
        where: {
          userId: params.userId,
          houseId: params.houseId,
          kind: params.kind,
          scenarioId,
        },
        select: { id: true },
      });

      const data = {
        userId: params.userId,
        houseId: params.houseId,
        kind: params.kind,
        scenarioId,
        anchorStartUtc: params.anchorStartUtc,
        anchorEndUtc: params.anchorEndUtc,
        derivationVersion: params.derivationVersion,
        buildInputsHash: params.buildInputsHash,
      };

      const series = existing
        ? await (tx as any).intervalSeries.update({
            where: { id: existing.id },
            data,
            select: { id: true },
          })
        : await (tx as any).intervalSeries.create({
            data,
            select: { id: true },
          });

      await (tx as any).intervalPoint15m.deleteMany({
        where: { seriesId: series.id },
      });

      return String(series.id);
    },
    {
      maxWait: 10_000,
      timeout: 15_000,
    }
  );

  let intervalChunksWritten = 0;
  for (let i = 0; i < prepared.length; i += chunkSize) {
    const chunk = prepared.slice(i, i + chunkSize);
    await usagePrisma.$transaction(
      async (tx) => {
        await (tx as any).intervalPoint15m.createMany({
          data: chunk.map((row) => ({
            seriesId,
            tsUtc: row.tsUtc,
            kwh: row.kwh,
          })),
        });
      },
      {
        maxWait: 10_000,
        timeout: 30_000,
      }
    );
    intervalChunksWritten += 1;
  }

  const diagnostics: IntervalSeriesPersistDiagnostics = {
    intervalRowsToPersist: prepared.length,
    intervalChunkSize: chunkSize,
    intervalChunksWritten,
    intervalPersistDurationMs: Date.now() - persistStartedAt,
    transactionTimeoutAvoided: true,
  };

  console.info("[intervalSeriesRepo] saveIntervalSeries15m", {
    userId: params.userId,
    houseId: params.houseId,
    kind: params.kind,
    scenarioId,
    ...diagnostics,
  });

  return { seriesId, diagnostics };
}

export async function getIntervalSeries15m(params: {
  userId: string;
  houseId: string;
  kind: IntervalSeriesKind;
  scenarioId?: string | null;
}): Promise<{
  header: {
    id: string;
    userId: string;
    houseId: string;
    kind: IntervalSeriesKind;
    scenarioId: string | null;
    anchorStartUtc: Date;
    anchorEndUtc: Date;
    derivationVersion: string;
    buildInputsHash: string;
    updatedAt: Date;
  };
  points: Array<{ tsUtc: Date; kwh: string }>;
} | null> {
  const scenarioId = params.scenarioId ?? null;
  const series = await (usagePrisma as any).intervalSeries.findFirst({
    where: {
      userId: params.userId,
      houseId: params.houseId,
      kind: params.kind,
      scenarioId,
    },
    select: {
      id: true,
      userId: true,
      houseId: true,
      kind: true,
      scenarioId: true,
      anchorStartUtc: true,
      anchorEndUtc: true,
      derivationVersion: true,
      buildInputsHash: true,
      updatedAt: true,
      points: {
        select: { tsUtc: true, kwh: true },
        orderBy: { tsUtc: "asc" },
      },
    },
  });

  if (!series) return null;

  return {
    header: {
      id: String(series.id),
      userId: String(series.userId),
      houseId: String(series.houseId),
      kind: series.kind as IntervalSeriesKind,
      scenarioId: series.scenarioId ? String(series.scenarioId) : null,
      anchorStartUtc: new Date(series.anchorStartUtc),
      anchorEndUtc: new Date(series.anchorEndUtc),
      derivationVersion: String(series.derivationVersion),
      buildInputsHash: String(series.buildInputsHash),
      updatedAt: new Date(series.updatedAt),
    },
    points: (series.points ?? []).map((p: any) => ({
      tsUtc: new Date(p.tsUtc),
      kwh: String(p.kwh),
    })),
  };
}
