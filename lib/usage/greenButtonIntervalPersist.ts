/** Bulk insert Green Button interval rows (usage DB). Tunable for droplet ingest latency. */
export const GREEN_BUTTON_INTERVAL_CREATE_BATCH_SIZE = 7000;

/** Parallel createMany calls per wave (usage DB connection pool). */
export const GREEN_BUTTON_INTERVAL_CREATE_PARALLEL = 5;

type CreateManyClient = {
  greenButtonInterval: {
    createMany: (args: { data: unknown[] }) => Promise<unknown>;
  };
};

export async function createManyGreenButtonIntervalsInBatches(
  usageClient: CreateManyClient,
  intervalData: unknown[]
): Promise<{ batches: number; rows: number }> {
  if (intervalData.length === 0) return { batches: 0, rows: 0 };

  const slices: unknown[][] = [];
  for (let i = 0; i < intervalData.length; i += GREEN_BUTTON_INTERVAL_CREATE_BATCH_SIZE) {
    slices.push(intervalData.slice(i, i + GREEN_BUTTON_INTERVAL_CREATE_BATCH_SIZE));
  }

  for (let i = 0; i < slices.length; i += GREEN_BUTTON_INTERVAL_CREATE_PARALLEL) {
    const wave = slices.slice(i, i + GREEN_BUTTON_INTERVAL_CREATE_PARALLEL);
    await Promise.all(
      wave.map((data) => usageClient.greenButtonInterval.createMany({ data }))
    );
  }

  return { batches: slices.length, rows: intervalData.length };
}
