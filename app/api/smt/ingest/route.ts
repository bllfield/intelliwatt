// app/api/smt/ingest/route.ts
// Step 15: SMT ingest — accept CSV or Green Button (ESPI) XML from SMT,
// normalize to `intervals15min: [{ ts, kwh }]`, return stats, and (optionally) run a quote.
//
// Accepted inputs (choose ONE of JSON or multipart/form-data):
// JSON:
//   POST {
//     type?: "csv" | "greenbutton" | "auto",
//     text: string,                          // raw file contents
//     tz?: "America/Chicago",                // optional, defaults to America/Chicago
//     // (optional) pass through to quoting
//     quote?: boolean,
//     address?: string, city?: string, state?: string, zip?: string, wattkey?: string,
//     monthlyKwh?: number,                   // if provided AND quote=true but no intervals, we use this
//     limit?: number,                        // cap offers in quote (default 30)
//     includeRaw?: boolean                   // include raw WattBuy offer payload in quote response
//   }
//
// multipart/form-data:
//   file: (CSV or XML file)
//   type: "csv" | "greenbutton" | "auto"    // optional
//   tz: "America/Chicago"                   // optional
//   quote: "true" | "false"                 // optional
//   address, city, state, zip, wattkey      // optional (quote needs either wattkey OR address+city+state+zip)
//   monthlyKwh, limit, includeRaw           // optional numbers/flags
//
// Response:
//   {
//     intervals15min: [{ ts, kwh }, ...],
//     stats: { intervals: number, totalKwh: number, firstTs: string, lastTs: string, days: number },
//     quote?: { ... } // present only if quote=true and location+usage supplied
//   }

import { NextRequest, NextResponse } from 'next/server';
import { parseSmtCsvToIntervals, parseGreenButtonToIntervals, type Interval15 } from '@/lib/smt/adapter';

export const runtime = 'nodejs';

type JsonBody = {
  type?: 'csv' | 'greenbutton' | 'auto';
  text?: string;
  tz?: string;
  quote?: boolean;
  address?: string;
  city?: string;
  state?: string;
  zip?: string;
  wattkey?: string;
  monthlyKwh?: number;
  limit?: number;
  includeRaw?: boolean;
};

export const maxDuration = 60; // allow larger uploads

export async function POST(req: NextRequest) {
  try {
    const ctype = req.headers.get('content-type') || '';
    let text = '';
    let type: 'csv' | 'greenbutton' | 'auto' = 'auto';
    let tz = 'America/Chicago';
    let quote = false;
    let address: string | undefined;
    let city: string | undefined;
    let state: string | undefined;
    let zip: string | undefined;
    let wattkey: string | undefined;
    let monthlyKwh: number | undefined;
    let limit: number | undefined;
    let includeRaw: boolean | undefined;

    if (ctype.includes('application/json')) {
      const body = (await req.json().catch(() => ({}))) as JsonBody;
      text = String(body.text ?? '');
      type = (body.type as any) || 'auto';
      tz = (body.tz as any) || 'America/Chicago';
      quote = !!body.quote;
      address = clean(body.address);
      city = clean(body.city);
      state = clean(body.state);
      zip = clean(body.zip);
      wattkey = clean(body.wattkey);
      monthlyKwh = toNum(body.monthlyKwh);
      limit = toInt(body.limit);
      includeRaw = !!body.includeRaw;
    } else if (ctype.includes('multipart/form-data')) {
      const form = await req.formData();
      const file = form.get('file') as File | null;
      if (file) {
        text = await file.text();
      } else {
        text = String(form.get('text') ?? '');
      }
      type = (String(form.get('type') || 'auto') as any) || 'auto';
      tz = String(form.get('tz') || 'America/Chicago');
      quote = String(form.get('quote') || '').toLowerCase() === 'true';
      address = clean(form.get('address') as string);
      city = clean(form.get('city') as string);
      state = clean(form.get('state') as string);
      zip = clean(form.get('zip') as string);
      wattkey = clean(form.get('wattkey') as string);
      monthlyKwh = toNum(form.get('monthlyKwh') as any);
      limit = toInt(form.get('limit') as any);
      includeRaw = String(form.get('includeRaw') || '').toLowerCase() === 'true';
    } else {
      return NextResponse.json({ error: 'Send JSON or multipart/form-data.' }, { status: 400 });
    }

    if (!text?.trim()) {
      return NextResponse.json({ error: 'No file contents provided.' }, { status: 400 });
    }

    // Auto-detect type if needed
    if (type === 'auto') {
      const head = text.slice(0, 200).trim();
      if (head.startsWith('<')) type = 'greenbutton';
      else type = 'csv';
    }

    // Normalize to intervals
    let intervals: Interval15[] = [];
    if (type === 'csv') {
      intervals = parseSmtCsvToIntervals(text, { tz });
    } else if (type === 'greenbutton') {
      intervals = parseGreenButtonToIntervals(text, { tz });
    } else {
      return NextResponse.json({ error: 'Unknown type.' }, { status: 400 });
    }

    if (!intervals.length) {
      return NextResponse.json({ error: 'Parsed 0 intervals. Verify file format and type.' }, { status: 422 });
    }

    // Build stats
    const firstTs = intervals[0].ts;
    const lastTs = intervals[intervals.length - 1].ts;
    const totalKwh = round2(intervals.reduce((s, r) => s + (r.kwh || 0), 0));
    const days = countDays(firstTs, lastTs);

    const response: any = {
      intervals15min: intervals,
      stats: { intervals: intervals.length, totalKwh, firstTs, lastTs, days },
    };

    // Optional: compute quote in one hop
    if (quote) {
      // prefer intervals; if not present (shouldn't happen), fall back to monthlyKwh if provided
      const usagePayload: any = intervals?.length
        ? { intervals15min: intervals }
        : typeof monthlyKwh === 'number' && monthlyKwh > 0
        ? { monthlyKwh }
        : null;

      // Location: either wattkey or full address
      let locationPayload: any = {};
      if (wattkey) locationPayload = { wattkey };
      else if (address && city && state && zip) locationPayload = { address, city, state, zip };
      else {
        response.quoteError = 'To compute a quote, provide either wattkey or address+city+state+zip.';
        return NextResponse.json(response);
      }

      const origin = new URL(req.url).origin;
      const qres = await fetch(`${origin}/api/recommendations/quote`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...locationPayload,
          ...usagePayload,
          limit: limit ?? 30,
          includeRaw: includeRaw ?? false,
        }),
      });

      if (!qres.ok) {
        response.quoteError = `Quote failed with status ${qres.status}`;
      } else {
        response.quote = await qres.json();
      }
    }

    return NextResponse.json(response);
  } catch (e: any) {
    const msg = typeof e?.message === 'string' ? e.message : 'SMT ingest failed';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

// ---------- helpers ----------
function clean(v?: string | null) {
  if (typeof v !== 'string') return undefined;
  const s = v.trim();
  return s.length ? s : undefined;
}
function toNum(v: any): number | undefined {
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}
function toInt(v: any): number | undefined {
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : undefined;
}
function round2(n: number) {
  return Math.round(n * 100) / 100;
}
function countDays(aIso: string, bIso: string) {
  const a = new Date(aIso);
  const b = new Date(bIso);
  const ms = Math.max(0, +b - +a);
  return Math.max(1, Math.ceil(ms / (24 * 3600 * 1000)));
}
