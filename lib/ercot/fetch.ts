import { sha256buf } from './resolve';
import { promises as fs } from 'node:fs';

const DEFAULT_UA = process.env.ERCOT_USER_AGENT ?? 'IntelliWattBot/1.0 (+https://intelliwatt.com)';

export async function fetchToTmp(url: string, userAgent?: string) {
  const ua = userAgent || DEFAULT_UA;
  const res = await fetch(url, { headers: { 'user-agent': ua } });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Fetch failed ${res.status}: ${text.slice(0, 500)}`);
  }
  const ab = await res.arrayBuffer();
  const buf = Buffer.from(ab);
  const sha = sha256buf(buf);
  const tmpPath = `/tmp/ercot_${sha}.dat`;
  await fs.writeFile(tmpPath, buf);
  const headers: Record<string, any> = {};
  res.headers.forEach((v, k) => (headers[k] = v));
  return { tmpPath, sha, headers };
}

