export function buildGapfillExportPayload<T extends Record<string, unknown>>(
  payloadBase: T,
  now: Date = new Date()
): T & { exportedAt: string } {
  return {
    ...payloadBase,
    exportedAt: now.toISOString(),
  };
}
