export type IngestResult = {
  status: 'ok' | 'skipped' | 'error'
  note?: string
  fileUrl?: string
  fileSha256?: string
  tdsp?: string
  rowCount?: number
  headers?: Record<string, string>
  error?: string
  errorDetail?: string
}

