export function mergeActualHouseDiagnosticsSnapshot(
  previousSnapshot: Record<string, unknown> | null,
  diagnosticsSnapshot: Record<string, unknown> | null
): Record<string, unknown> | null {
  if (!previousSnapshot) return diagnosticsSnapshot;
  if (!diagnosticsSnapshot) return previousSnapshot;
  return {
    ...previousSnapshot,
    ...(Object.prototype.hasOwnProperty.call(diagnosticsSnapshot, "engineContext")
      ? { engineContext: diagnosticsSnapshot.engineContext ?? null }
      : {}),
  };
}
