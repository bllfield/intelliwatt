import https from 'https';
import { assertNodeRuntime } from '@/lib/node/_guard';

assertNodeRuntime();

export async function fetchWithRetries(url: string, opts: RequestInit = {}, attempts = 3): Promise<Response> {
  let attempt = 0;
  let lastError: any;
  const backoff = opts?.headers && 'retry-after' in opts.headers ? 0 : 800;

  while (attempt < attempts) {
    try {
      const res = await fetch(url, opts);
      if (!res.ok && attempt < attempts - 1) {
        throw new Error(`HTTP ${res.status}`);
      }
      return res;
    } catch (err) {
      lastError = err;
      attempt += 1;
      if (attempt >= attempts) break;
      await new Promise((resolve) => setTimeout(resolve, backoff * Math.pow(2, attempt - 1)));
    }
  }
  throw lastError;
}

export type FetchOpts = {
  url: string;
  retries?: number;
  backoffMs?: number;
  timeoutMs?: number;
  userAgent?: string;
  insecureTLS?: boolean;
};

export async function fetchText(url: string, opts: RequestInit = {}, attempts = 3): Promise<string> {
  const res = await fetchWithRetries(url, opts, attempts);
  return await res.text();
}

export async function fetchToBuffer(opts: FetchOpts): Promise<Buffer> {
  const {
    url,
    retries = 3,
    backoffMs = 800,
    timeoutMs = 30000,
    userAgent = process.env.ERCOT_USER_AGENT || 'IntelliWatt/ercot-fetch',
    insecureTLS = process.env.NODE_TLS_REJECT_UNAUTHORIZED === '0',
  } = opts;

  let attempt = 0;
  while (true) {
    try {
      const buf: Buffer = await new Promise((resolve, reject) => {
        const req = https.get(url, {
          headers: { 'User-Agent': userAgent, Accept: '*/*' },
          rejectUnauthorized: !insecureTLS,
          timeout: timeoutMs,
        }, (res) => {
          if (res.statusCode && res.statusCode >= 300) {
            reject(new Error(`HTTP ${res.statusCode}`));
            res.resume();
            return;
          }
          const chunks: Buffer[] = [];
          res.on('data', (c) => chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c)));
          res.on('end', () => resolve(Buffer.concat(chunks)));
        });
        req.on('error', reject);
        req.on('timeout', () => req.destroy(new Error('Request timeout')));
      });
      return buf;
    } catch (err) {
      attempt += 1;
      if (attempt > retries) throw err;
      await new Promise((r) => setTimeout(r, backoffMs * Math.pow(2, attempt - 1)));
    }
  }
}
