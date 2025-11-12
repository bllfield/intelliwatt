import crypto from 'crypto';
import { putObject } from '@/lib/ercot/upload';

export type SaveRawParams = {
  source: string;
  filename: string;
  mime: string;
  buf: Buffer;
};

export type SaveRawResult = {
  source: string;
  filename: string;
  storagePath: string;
  sha256: string;
  sizeBytes: number;
  contentType: string;
};

export async function saveRawToStorage({ source, filename, mime, buf }: SaveRawParams): Promise<SaveRawResult> {
  const sanitizedSource = source.replace(/^\/+|\/+$/g, '') || 'adhocusage';
  const sanitizedFilename = filename.replace(/^\/+|\/+$/g, '') || `adhoc-${Date.now()}.csv`;

  const sizeBytes = buf.length;
  const sha256 = crypto.createHash('sha256').update(buf).digest('hex');
  const storagePath = `/${sanitizedSource}/${sanitizedFilename}`;
  const key = storagePath.replace(/^\//, '');

  await putObject(key, buf, mime || 'application/octet-stream');

  return {
    source: sanitizedSource,
    filename: sanitizedFilename,
    storagePath,
    sha256,
    sizeBytes,
    contentType: mime,
  };
}
