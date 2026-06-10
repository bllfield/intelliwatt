type InflightEntry = {
  promise: Promise<unknown>;
  startedAt: number;
};

const inflightByKey = new Map<string, InflightEntry>();

export function pastSimUserReadInflightKey(args: {
  userId: string;
  houseId: string;
  scenarioId: string;
}): string {
  return `${args.userId}:${args.houseId}:${args.scenarioId}`;
}

/** Coalesce concurrent user Past reads for the same home/scenario into one rebuild. */
export async function runPastSimUserReadInflight<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const existing = inflightByKey.get(key);
  if (existing) {
    return existing.promise as Promise<T>;
  }
  const promise = fn().finally(() => {
    const current = inflightByKey.get(key);
    if (current?.promise === promise) {
      inflightByKey.delete(key);
    }
  });
  inflightByKey.set(key, { promise, startedAt: Date.now() });
  return promise;
}

/** Test-only: reset module state between unit tests. */
export function resetPastSimUserReadInflightForTests(): void {
  inflightByKey.clear();
}
