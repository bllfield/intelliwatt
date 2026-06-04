/** Bulk insert Green Button interval rows (usage DB). Tunable for droplet ingest latency. */
export const GREEN_BUTTON_INTERVAL_CREATE_BATCH_SIZE = 7000;

/** Parallel createMany calls per wave (usage DB connection pool). */
export const GREEN_BUTTON_INTERVAL_CREATE_PARALLEL = 5;

export type GreenButtonIntervalInsertProgress = {
  phase: "insert_start" | "wave_start" | "batch_start" | "batch_complete" | "wave_complete" | "insert_complete";
  totalRows: number;
  batchCount: number;
  parallelPerWave: number;
  waveIndex?: number;
  waveCount?: number;
  batchIndex?: number;
  rowsInWave?: number;
  rowsInBatch?: number;
  rowsCompleted?: number;
  elapsedMs?: number;
};

type CreateManyClient = {
  greenButtonInterval: {
    createMany: (args: { data: unknown[] }) => Promise<unknown>;
  };
};

export async function createManyGreenButtonIntervalsInBatches(
  usageClient: CreateManyClient,
  intervalData: unknown[],
  options?: { onProgress?: (progress: GreenButtonIntervalInsertProgress) => void }
): Promise<{ batches: number; rows: number; waves: number }> {
  if (intervalData.length === 0) {
    options?.onProgress?.({
      phase: "insert_complete",
      totalRows: 0,
      batchCount: 0,
      parallelPerWave: GREEN_BUTTON_INTERVAL_CREATE_PARALLEL,
      rowsCompleted: 0,
    });
    return { batches: 0, rows: 0, waves: 0 };
  }

  const slices: unknown[][] = [];
  for (let i = 0; i < intervalData.length; i += GREEN_BUTTON_INTERVAL_CREATE_BATCH_SIZE) {
    slices.push(intervalData.slice(i, i + GREEN_BUTTON_INTERVAL_CREATE_BATCH_SIZE));
  }

  const waveCount = Math.ceil(slices.length / GREEN_BUTTON_INTERVAL_CREATE_PARALLEL);
  let rowsCompleted = 0;

  options?.onProgress?.({
    phase: "insert_start",
    totalRows: intervalData.length,
    batchCount: slices.length,
    parallelPerWave: GREEN_BUTTON_INTERVAL_CREATE_PARALLEL,
    waveCount,
    rowsCompleted: 0,
  });

  for (let i = 0; i < slices.length; i += GREEN_BUTTON_INTERVAL_CREATE_PARALLEL) {
    const waveIndex = Math.floor(i / GREEN_BUTTON_INTERVAL_CREATE_PARALLEL) + 1;
    const wave = slices.slice(i, i + GREEN_BUTTON_INTERVAL_CREATE_PARALLEL);
    const rowsInWave = wave.reduce((sum, slice) => sum + slice.length, 0);
    const waveStart = Date.now();

    options?.onProgress?.({
      phase: "wave_start",
      totalRows: intervalData.length,
      batchCount: slices.length,
      parallelPerWave: GREEN_BUTTON_INTERVAL_CREATE_PARALLEL,
      waveIndex,
      waveCount,
      rowsInWave,
      rowsCompleted,
    });

    await Promise.all(
      wave.map(async (data, slotInWave) => {
        const batchIndex = i + slotInWave + 1;
        options?.onProgress?.({
          phase: "batch_start",
          totalRows: intervalData.length,
          batchCount: slices.length,
          parallelPerWave: GREEN_BUTTON_INTERVAL_CREATE_PARALLEL,
          waveIndex,
          waveCount,
          batchIndex,
          rowsInBatch: data.length,
          rowsCompleted,
        });
        const batchStart = Date.now();
        await usageClient.greenButtonInterval.createMany({ data });
        rowsCompleted += data.length;
        options?.onProgress?.({
          phase: "batch_complete",
          totalRows: intervalData.length,
          batchCount: slices.length,
          parallelPerWave: GREEN_BUTTON_INTERVAL_CREATE_PARALLEL,
          waveIndex,
          waveCount,
          batchIndex,
          rowsInBatch: data.length,
          rowsCompleted,
          elapsedMs: Date.now() - batchStart,
        });
      })
    );

    options?.onProgress?.({
      phase: "wave_complete",
      totalRows: intervalData.length,
      batchCount: slices.length,
      parallelPerWave: GREEN_BUTTON_INTERVAL_CREATE_PARALLEL,
      waveIndex,
      waveCount,
      rowsInWave,
      rowsCompleted,
      elapsedMs: Date.now() - waveStart,
    });
  }

  options?.onProgress?.({
    phase: "insert_complete",
    totalRows: intervalData.length,
    batchCount: slices.length,
    parallelPerWave: GREEN_BUTTON_INTERVAL_CREATE_PARALLEL,
    waveCount,
    rowsCompleted,
  });

  return { batches: slices.length, rows: intervalData.length, waves: waveCount };
}
