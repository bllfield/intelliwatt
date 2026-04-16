/**
 * Race a promise against a wall-clock timeout (plan §6 recalc timeout for inline dispatch).
 */
export async function raceWithTimeout<T>(
  task: Promise<T>,
  timeoutMs: number,
  timeoutErrorCode: string
): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => {
      const err = new Error(timeoutErrorCode);
      (err as { code?: string }).code = timeoutErrorCode;
      reject(err);
    }, timeoutMs);
  });
  try {
    return await Promise.race([task, timeoutPromise]);
  } finally {
    if (timeoutId != null) clearTimeout(timeoutId);
  }
}

