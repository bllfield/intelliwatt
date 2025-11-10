export type IngestStatus = 'ok' | 'skipped' | 'error';

export interface IngestResult {
  status: IngestStatus;
  note?: string;
  fileUrl: string;
  fileSha256: string;
  tdsp?: string;
  rowCount?: number;
  headers?: Record<string, any>;
  error?: string;
  errorDetail?: string;
}

export interface ResolvedCandidate {
  url: string;
  tdsp?: string;
  hint?: string;
}

