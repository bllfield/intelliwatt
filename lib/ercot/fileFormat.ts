/**
 * Helpers to sniff simple ERCOT flat files and iterate rows.
 */
import fs from 'fs';
import readline from 'readline';
import { assertNodeRuntime } from '@/lib/node/_guard';

assertNodeRuntime();

export type Row = Record<string, string>;
export type Sniff = { delimiter: string; headers: string[] };

export async function sniffFormat(filePath: string): Promise<Sniff> {
  const first = await readFirstLine(filePath);
  const candidates = ['|', ',', '\t', ';'];
  let best: Sniff = { delimiter: ',', headers: [] };
  let bestScore = -1;
  for (const d of candidates) {
    const parts = first.split(d);
    const score = parts.length;
    if (score > bestScore) {
      bestScore = score;
      best = { delimiter: d, headers: parts.map((h) => sanitize(h)) };
    }
  }
  return best;
}

async function readFirstLine(filePath: string): Promise<string> {
  const stream = fs.createReadStream(filePath);
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });
  let line = '';
  for await (const l of rl) { line = l; break; }
  rl.close();
  stream.close();
  return line || '';
}

export function sanitize(s: string): string {
  return (s || '').trim().replace(/\uFEFF/g, '');
}

export async function* iterRows(filePath: string, delimiter: string, headers: string[]) {
  const stream = fs.createReadStream(filePath);
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });
  let first = true;
  for await (const raw of rl) {
    if (first) { first = false; continue; }
    if (!raw || !raw.trim()) continue;
    const cells = raw.split(delimiter).map((c) => sanitize(c));
    const row: Row = {};
    for (let i = 0; i < headers.length; i++) {
      row[headers[i]] = cells[i] ?? '';
    }
    yield row;
  }
  rl.close();
  stream.close();
}
