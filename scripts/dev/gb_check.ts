import fs from 'fs';
import path from 'path';
import { parseGreenButtonBuffer } from '@/lib/usage/greenButtonParser';
import { normalizeGreenButtonReadingsTo15Min } from '@/lib/usage/greenButtonNormalize';

function fmtDate(d: Date | null) {
  return d ? d.toISOString() : 'n/a';
}

async function main() {
  const argPath = process.argv[2];
  if (!argPath) {
    console.error('Usage: tsx scripts/dev/gb_check.ts <file>');
    process.exit(1);
  }
  const filePath = path.resolve(argPath);
  const buf = fs.readFileSync(filePath);

  const parsed = parseGreenButtonBuffer(buf, path.basename(filePath));
  if (parsed.errors.length) {
    console.error('parse errors:', parsed.errors);
    process.exit(1);
  }
  console.log('format:', parsed.format, 'readings:', parsed.readings.length, 'warnings:', parsed.warnings.length);

  const normalized = normalizeGreenButtonReadingsTo15Min(parsed.readings, {
    maxKwhPerInterval: 10,
  });
  console.log('normalized intervals:', normalized.length);

  if (!normalized.length) return;

  const minTs = normalized[0].timestamp;
  const maxTs = normalized[normalized.length - 1].timestamp;

  const totalKwh = normalized.reduce((sum, r) => sum + r.consumptionKwh, 0);
  const maxInterval = normalized.reduce((m, r) => Math.max(m, r.consumptionKwh), 0);

  // Trim to last 365 days from maxTs
  const cutoff = new Date(maxTs.getTime() - 365 * 24 * 60 * 60 * 1000);
  const trimmed = normalized.filter((r) => r.timestamp >= cutoff && r.timestamp <= maxTs);
  const trimmedTotal = trimmed.reduce((sum, r) => sum + r.consumptionKwh, 0);

  console.log({
    minTs: fmtDate(minTs),
    maxTs: fmtDate(maxTs),
    totalKwh: Number(totalKwh.toFixed(6)),
    maxIntervalKwh: Number(maxInterval.toFixed(6)),
    trimmedCount: trimmed.length,
    trimmedTotalKwh: Number(trimmedTotal.toFixed(6)),
    cutoff: fmtDate(cutoff),
  });

  // check duplicates by timestamp
  const seen = new Set<number>();
  let dupes = 0;
  for (const r of normalized) {
    const k = r.timestamp.getTime();
    if (seen.has(k)) dupes += 1;
    seen.add(k);
  }
  console.log({ duplicates: dupes });
}

main();
