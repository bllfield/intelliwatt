export type GreenButtonUploadStatusRow = {
  parseStatus: string | null;
  parseMessage: string | null;
  dateRangeStart: Date | null;
  dateRangeEnd: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

export function isGreenButtonUploadParseError(parseStatus: string | null | undefined): boolean {
  const raw = String(parseStatus ?? "").toLowerCase();
  return raw.includes("error") || raw === "failed" || raw === "empty";
}

export function isGreenButtonUploadReady(upload: GreenButtonUploadStatusRow | null | undefined): boolean {
  if (!upload) return false;
  const raw = String(upload.parseStatus ?? "").toLowerCase();
  if (isGreenButtonUploadParseError(raw)) return false;
  if (["success", "complete", "complete_with_warnings"].includes(raw)) return true;
  return Boolean(upload.dateRangeStart && upload.dateRangeEnd);
}

export function isGreenButtonUploadProcessing(upload: GreenButtonUploadStatusRow | null | undefined): boolean {
  if (!upload) return false;
  if (isGreenButtonUploadParseError(upload.parseStatus) || isGreenButtonUploadReady(upload)) return false;
  const raw = String(upload.parseStatus ?? "").toLowerCase();
  return raw === "processing" || raw.length === 0;
}
