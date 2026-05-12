type QueueReasonRecord = Record<string, unknown>;

function asQueueReasonRecord(value: unknown): QueueReasonRecord | null {
  if (!value) return null;
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return parsed && typeof parsed === "object" ? (parsed as QueueReasonRecord) : null;
    } catch {
      return null;
    }
  }
  return typeof value === "object" ? (value as QueueReasonRecord) : null;
}

export function withQueueEvidenceFingerprint<T extends QueueReasonRecord>(
  payload: T,
  evidenceFingerprint: string | null | undefined,
): T & { evidenceFingerprint?: string | null } {
  if (!evidenceFingerprint) return payload;
  return {
    ...payload,
    evidenceFingerprint,
  };
}

export function getQueueEvidenceFingerprint(
  queueReason: unknown,
): string | null {
  const record = asQueueReasonRecord(queueReason);
  const fingerprint = record?.evidenceFingerprint;
  return typeof fingerprint === "string" && fingerprint.trim()
    ? fingerprint.trim()
    : null;
}

export function shouldWriteOpenQueueRowForEvidence(args: {
  resolvedAt: Date | string | null | undefined;
  queueReason: unknown;
  evidenceFingerprint: string | null | undefined;
}): boolean {
  if (!args.resolvedAt) return true;
  const previousFingerprint = getQueueEvidenceFingerprint(args.queueReason);
  const nextFingerprint =
    typeof args.evidenceFingerprint === "string" && args.evidenceFingerprint.trim()
      ? args.evidenceFingerprint.trim()
      : null;
  if (!previousFingerprint || !nextFingerprint) return false;
  return previousFingerprint !== nextFingerprint;
}
