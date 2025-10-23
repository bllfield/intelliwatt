// lib/smt/adapter.ts
// Normalizes SMT usage into the intervals shape your quote engine expects.

import * as Papa from 'papaparse';

// Internal shape used by your calculator
export type Interval15 = { ts: string; kwh: number };

// ---- CSV PARSER ----
// Handles common SMT CSVs. We try a few header patterns and fall back gracefully.
export function parseSmtCsvToIntervals(csvText: string, opts?: { tz?: string }): Interval15[] {
  const tz = opts?.tz ?? 'America/Chicago';
  const { data, errors } = Papa.parse<any>(csvText, { header: true, skipEmptyLines: true });
  if (errors?.length) {
    // not throwing; we'll attempt best-effort mapping
    // console.warn('SMT CSV parse warnings:', errors.slice(0, 3));
  }

  const rows: any[] = Array.isArray(data) ? data : [];
  const out: Interval15[] = [];

  for (const r of rows) {
    // Try common header variants
    const date =
      r.Date || r['Service Date'] || r['Interval Date'] || r['Reading Date'] || r['Usage Date'];
    const start =
      r['Interval Start'] || r['Start Time'] || r['Interval Start Time'] || r['Start'];
    const end = r['Interval End'] || r['End Time'] || r['Interval End Time'] || r['End'];

    // Some SMT CSVs only include "Interval End" timestamps; others include both.
    const tsStr =
      (date && end && `${date} ${end}`) ||
      (date && start && `${date} ${start}`) ||
      (r['DateTime'] as string) ||
      (r['Date Time'] as string);

    const kwh =
      num(r.kWh) ??
      num(r['kWh']) ??
      num(r['Usage (kWh)']) ??
      num(r['Consumption kWh']) ??
      num(r['Usage']);

    if (!tsStr || kwh == null) continue;

    // Build a local time ISO string in America/Chicago
    // We keep wall-clock time; DST days will have 92/100 intervals, which is OK.
    const tsIso = toLocalIso(tsStr, tz);
    if (!tsIso) continue;

    out.push({ ts: tsIso, kwh: Math.max(0, kwh) });
  }

  // Sort just in case
  out.sort((a, b) => +new Date(a.ts) - +new Date(b.ts));
  return out;
}

// ---- Green Button (ESPI) XML PARSER ----
// Accepts the raw XML string and extracts IntervalReading { start, duration, value }.
// SMT/GreenButton typically uses seconds since epoch and watt-hours.
export function parseGreenButtonToIntervals(xmlText: string, opts?: { tz?: string }): Interval15[] {
  const tz = opts?.tz ?? 'America/Chicago';
  // Lightweight XML parse without external deps
  const starts = matchAll(xmlText, /<start>(\d+)<\/start>/g).map((m) => Number(m[1]));
  const durations = matchAll(xmlText, /<duration>(\d+)<\/duration>/g).map((m) => Number(m[1]));
  const valuesWh = matchAll(xmlText, /<value>(\d+)<\/value>/g).map((m) => Number(m[1]));

  const len = Math.min(starts.length, durations.length, valuesWh.length);
  const out: Interval15[] = [];
  for (let i = 0; i < len; i++) {
    const startEpoch = starts[i];
    const durSec = durations[i] || 900; // default 15-minute
    const endEpoch = startEpoch + durSec;
    const kwh = Math.max(0, valuesWh[i] / 1000); // Wh → kWh

    // Convert epoch seconds to local ISO (America/Chicago)
    const tsIso = epochToLocalIso(endEpoch, tz); // use interval END as timestamp
    out.push({ ts: tsIso, kwh });
  }

  out.sort((a, b) => +new Date(a.ts) - +new Date(b.ts));
  return out;
}

// -------------- helpers --------------
function num(v: any): number | null {
  if (v == null) return null;
  const n = Number(String(v).replace(/,/g, '').trim());
  return Number.isFinite(n) ? n : null;
}

function toLocalIso(dateTime: string, tz: string): string | null {
  // Accepts "YYYY-MM-DD HH:mm" or similar; let Date parse, then recompose as local ISO
  const d = new Date(dateTime);
  if (isNaN(+d)) return null;
  return toIsoInTz(d, tz);
}

function epochToLocalIso(epochSec: number, tz: string): string {
  const d = new Date(epochSec * 1000);
  return toIsoInTz(d, tz);
}

function toIsoInTz(d: Date, tz: string): string {
  // Build a YYYY-MM-DDTHH:mm:ss local string in the given tz (without forcing Z)
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  });
  const parts = Object.fromEntries(fmt.formatToParts(d).map(p => [p.type, p.value]));
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}`;
}

function matchAll(text: string, re: RegExp): RegExpExecArray[] {
  const out: RegExpExecArray[] = [];
  let m: RegExpExecArray | null;
  const r = new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g');
  while ((m = r.exec(text))) out.push(m);
  return out;
}
