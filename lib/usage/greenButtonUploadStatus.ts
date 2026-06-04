import { isGreenButtonIntervalIngestCurrent } from "@/lib/usage/greenButtonIngestContract";

export type GreenButtonUploadStatusRow = {
  parseStatus: string | null;
  parseMessage: string | null;
  dateRangeStart: Date | null;
  dateRangeEnd: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

function isGreenButtonUploadParseStatusProcessing(parseStatus: string | null | undefined): boolean {
  return String(parseStatus ?? "").toLowerCase() === "processing";
}

export function isGreenButtonUploadParseError(parseStatus: string | null | undefined): boolean {
  const raw = String(parseStatus ?? "").toLowerCase();
  return raw.includes("error") || raw === "failed" || raw === "empty";
}

export function isGreenButtonUploadReady(upload: GreenButtonUploadStatusRow | null | undefined): boolean {
  if (!upload) return false;
  const raw = String(upload.parseStatus ?? "").toLowerCase();
  if (isGreenButtonUploadParseError(raw)) return false;
  if (isGreenButtonUploadParseStatusProcessing(upload.parseStatus)) return false;
  if (["success", "complete", "complete_with_warnings"].includes(raw)) return true;
  return Boolean(upload.dateRangeStart && upload.dateRangeEnd);
}

export function isGreenButtonUploadProcessing(upload: GreenButtonUploadStatusRow | null | undefined): boolean {
  if (!upload) return false;
  if (isGreenButtonUploadParseError(upload.parseStatus) || isGreenButtonUploadReady(upload)) return false;
  const raw = String(upload.parseStatus ?? "").toLowerCase();
  return raw === "processing" || raw.length === 0;
}

/** Usage is display-ready only after persisted interval rows exist (upload metadata alone is not enough). */
export function isGreenButtonUsageIngestionReady(
  upload: GreenButtonUploadStatusRow | null | undefined,
  persistedIntervalCount: number
): boolean {
  const intervalCount = Math.max(0, Number(persistedIntervalCount) || 0);
  if (!upload || intervalCount <= 0) return false;
  if (!isGreenButtonUploadReady(upload)) return false;
  return isGreenButtonIntervalIngestCurrent(upload.parseMessage);
}

/** Includes parse in-flight and the gap where upload metadata is complete but intervals are not queryable yet. */
export function isGreenButtonUsageIngestionProcessing(
  upload: GreenButtonUploadStatusRow | null | undefined,
  persistedIntervalCount: number
): boolean {
  if (!upload) return false;
  if (isGreenButtonUploadParseError(upload.parseStatus)) return false;
  const intervalCount = Math.max(0, Number(persistedIntervalCount) || 0);
  if (isGreenButtonUsageIngestionReady(upload, intervalCount)) return false;
  const raw = String(upload.parseStatus ?? "").toLowerCase();
  if (raw === "processing" || raw.length === 0) return true;
  if (isGreenButtonUploadReady(upload) && intervalCount === 0) return true;
  if (intervalCount > 0 && !isGreenButtonIntervalIngestCurrent(upload.parseMessage)) return true;
  return false;
}
