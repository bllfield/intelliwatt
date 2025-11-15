import { parseSmtCsvFlexible } from '@/lib/smt/parseCsv';
import {
  groupNormalize,
  type SmtAdhocRow,
} from '@/lib/analysis/normalizeSmt';

export type NormalizeDefaults = {
  esiid?: string | null;
  meter?: string | null;
  source?: string | null;
};

export type NormalizedInterval = {
  esiid: string;
  meter: string;
  ts: Date;
  kwh: number;
  source: string | null;
};

export type NormalizeStats = {
  totalRows: number;
  processedRows: number;
  invalidEsiid: number;
  invalidTimestamp: number;
  invalidKwh: number;
  totalKwh: number;
  tsMin: string | null;
  tsMax: string | null;
};

function normalizeEsiid(raw?: string | null, fallback?: string | null): string | null {
  const candidate = (raw ?? fallback ?? '').trim();
  if (!candidate) return null;
  const stripped = candidate.replace(/^'+/, '');
  return stripped || null;
}

function normalizeMeter(raw?: string | null, fallback?: string | null): string {
  const candidate = (raw ?? fallback ?? '').trim();
  return candidate || 'unknown';
}

function deriveTimestamp(entry: {
  endLocal?: string | null;
  dateTimeLocal?: string | null;
  startLocal?: string | null;
}): string | null {
  let timestamp = entry.endLocal ?? entry.dateTimeLocal ?? null;
  if (!timestamp && entry.startLocal) {
    const startDate = new Date(entry.startLocal);
    if (!Number.isNaN(startDate.getTime())) {
      const endDate = new Date(startDate.getTime() + 15 * 60 * 1000);
      timestamp = endDate.toISOString();
    } else {
      timestamp = entry.startLocal;
    }
  }
  return timestamp ?? null;
}

function parseKwh(value: unknown): number | null {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value === 'string') {
    const parsed = Number(value.trim());
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

export function normalizeSmtIntervals(
  csvText: string,
  defaults: NormalizeDefaults = {},
): { intervals: NormalizedInterval[]; stats: NormalizeStats } {
  const parsed = parseSmtCsvFlexible(csvText);

  const rows: SmtAdhocRow[] = [];
  let invalidEsiid = 0;
  let invalidTimestamp = 0;
  let invalidKwh = 0;

  for (const entry of parsed) {
    const timestamp = deriveTimestamp(entry);
    if (!timestamp) {
      invalidTimestamp += 1;
      continue;
    }

    const esiid = normalizeEsiid(entry.esiid, defaults.esiid);
    if (!esiid) {
      invalidEsiid += 1;
      continue;
    }

    const meter = normalizeMeter(entry.meter, defaults.meter);

    const kwh = parseKwh(entry.kwh);
    if (kwh === null) {
      invalidKwh += 1;
      continue;
    }

    rows.push({
      esiid,
      meter,
      timestamp,
      kwh,
    });
  }

  const grouped = groupNormalize(rows, 'esiid_meter', { tz: 'America/Chicago' });
  const intervals: NormalizedInterval[] = [];

  let totalKwh = 0;
  let tsMin: string | null = null;
  let tsMax: string | null = null;

  for (const [composite, { points }] of Object.entries(grouped.groups)) {
    const [esiidKey, meterKey] = composite.split('|');
    const resolvedEsiid = normalizeEsiid(esiidKey, defaults.esiid);
    const resolvedMeter = normalizeMeter(meterKey, defaults.meter);

    if (!resolvedEsiid) {
      continue;
    }

    for (const point of points) {
      if (typeof point.kwh !== 'number' || !Number.isFinite(point.kwh)) continue;
      const tsDate = new Date(point.ts);
      if (Number.isNaN(tsDate.getTime())) continue;

      intervals.push({
        esiid: resolvedEsiid,
        meter: resolvedMeter,
        ts: tsDate,
        kwh: point.kwh,
        source: defaults.source ?? null,
      });

      totalKwh += point.kwh;
      if (!tsMin || point.ts < tsMin) tsMin = point.ts;
      if (!tsMax || point.ts > tsMax) tsMax = point.ts;
    }
  }

  const stats: NormalizeStats = {
    totalRows: parsed.length,
    processedRows: rows.length,
    invalidEsiid,
    invalidTimestamp,
    invalidKwh,
    totalKwh,
    tsMin,
    tsMax,
  };

  return { intervals, stats };
}

