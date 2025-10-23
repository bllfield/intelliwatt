// lib/efl.ts
// Step 9: EFL fetch + lightweight parser (regex heuristics) to populate RateConfig fields.
// Install deps:
//   npm i pdf-parse cheerio html-to-text
//
// Notes:
// - Many TX EFL links are PDFs (ideal), some are HTML "viewer" pages that link to a PDF.
// - We fetch the URL, try to detect content-type, extract text, compute checksum,
//   and parse common fields (base fee, per-kWh bands, usage credits, TDU charges, term, cancel fee).
// - This is a starter parser. You'll keep adding patterns as you encounter new EFL formats.

import crypto from 'crypto';
import type { CheerioAPI } from 'cheerio';

export type ParsedBands = Array<{ min: number; max: number | null; cents: number }>;
export type ParsedCredit =
  | { type: 'threshold_credit'; thresholdKwh: number; creditCents: number }
  | { type: 'monthly_fee'; cents: number };

export type ParsedTouWindow = { start: string; end: string; cents: number };

export type ParsedEfl = {
  baseMonthlyFeeCents?: number;
  tduDeliveryCentsPerKwh?: number;
  centsPerKwhBands?: ParsedBands;
  usageCredits?: ParsedCredit[];
  touWindows?: ParsedTouWindow[];
  otherFees?: Record<string, any>;
  termMonths?: number;
  cancelFee?: string;
  avgPrice500?: number;
  avgPrice1000?: number;
  avgPrice2000?: number;
  notes?: string[];
};

export type FetchedEfl = {
  url: string;
  finalUrl: string;
  contentType?: string | null;
  text?: string;
  isPdf: boolean;
  checksum: string;
  parsed: ParsedEfl;
};

const isPdfContentType = (ct?: string | null) =>
  !!ct && /application\/pdf/i.test(ct);

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function fetchBuffer(url: string): Promise<{ buf: Buffer; contentType?: string | null; finalUrl: string }> {
  const res = await fetch(url, { redirect: 'follow', cache: 'no-store' });
  const contentType = res.headers.get('content-type');
  const buf = Buffer.from(await res.arrayBuffer());
  return { buf, contentType, finalUrl: res.url || url };
}

async function extractPdfText(buf: Buffer): Promise<string> {
  const pdfParse = await import('pdf-parse');
  const data = await pdfParse.default(buf);
  return data.text || '';
}

async function extractHtmlText(htmlBuf: Buffer): Promise<{ text: string; $: CheerioAPI }> {
  const html = htmlBuf.toString('utf8');
  const cheerio = (await import('cheerio')).load;
  const $ = cheerio(html);
  const { htmlToText } = await import('html-to-text');
  const text = htmlToText(html, {
    wordwrap: false,
    selectors: [
      { selector: 'script,style,noscript', format: 'skip' },
      { selector: 'a', options: { ignoreHref: true } },
    ],
  });
  return { text, $ };
}

function centsFromDollarsLike(s: string): number | undefined {
  // "$12.34" => 1234 ; "12" => 1200
  const m = s.replace(/[, ]/g, '').match(/([0-9]+(?:\.[0-9]{1,2})?)/);
  if (!m) return undefined;
  const dollars = parseFloat(m[1]);
  if (!isFinite(dollars)) return undefined;
  return Math.round(dollars * 100);
}

function numberLike(s: string): number | undefined {
  const m = s.replace(/[, ]/g, '').match(/([0-9]+(?:\.[0-9]+)?)/);
  if (!m) return undefined;
  const n = parseFloat(m[1]);
  return isFinite(n) ? n : undefined;
}

function parseBandsByKwh(text: string): ParsedBands | undefined {
  // Looks for tiered energy charge bands e.g. "0-1000 kWh: 9.5¢, 1001+ kWh: 13.2¢"
  const bands: ParsedBands = [];
  const re =
    /(?:(\d{1,6})(?:\s*-\s*(\d{1,6}))|\b(\d{1,6})\s*\+)\s*kWh.*?([0-9]+(?:\.[0-9]+)?)\s*(?:¢|cents?)\s*\/?\s*kWh/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const min = m[1] ? parseInt(m[1], 10) : m[3] ? parseInt(m[3], 10) : 0;
    const max = m[2] ? parseInt(m[2], 10) : m[3] ? null : undefined;
    const cents = parseFloat(m[4]);
    if (isFinite(cents)) bands.push({ min, max: max ?? null, cents });
  }
  return bands.length ? bands : undefined;
}

function parseAvgPrices(text: string) {
  // "Average Price at 500 / 1000 / 2000 kWh: 15.0¢ 14.2¢ 13.1¢"
  const re =
    /Average\s+Price.*?(?:500[^0-9]+([0-9]+(?:\.[0-9]+)?)\s*(?:¢|c))[^0-9]+(?:1000[^0-9]+([0-9]+(?:\.[0-9]+)?)\s*(?:¢|c))[^0-9]+(?:2000[^0-9]+([0-9]+(?:\.[0-9]+)?)\s*(?:¢|c))/is;
  const m = re.exec(text);
  if (!m) return {};
  return {
    avgPrice500: parseFloat(m[1]),
    avgPrice1000: parseFloat(m[2]),
    avgPrice2000: parseFloat(m[3]),
  };
}

function parseUsageCredit(text: string): ParsedCredit[] | undefined {
  // e.g., "$125 usage credit when usage is above or equal to 1000 kWh"
  const out: ParsedCredit[] = [];
  const re =
    /\$?\s*([0-9]+(?:\.[0-9]{1,2})?)\s*(?:bill|usage)\s*credit.*?(?:>=?|above|over|at\s+least)\s*([0-9,]+)\s*kWh/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const creditCents = Math.round(parseFloat(m[1]) * 100);
    const thresholdKwh = parseInt(m[2].replace(/,/g, ''), 10);
    if (isFinite(creditCents) && isFinite(thresholdKwh)) {
      out.push({ type: 'threshold_credit', thresholdKwh, creditCents });
    }
  }
  return out.length ? out : undefined;
}

function parseBaseMonthlyFee(text: string): number | undefined {
  // "Base charge: $9.95 per month"
  const re = /(base\s*(?:charge|fee)[^$0-9]{0,20}\$?\s*([0-9]+(?:\.[0-9]{1,2})?))/i;
  const m = re.exec(text);
  if (!m) return;
  return centsFromDollarsLike(m[2]!);
}

function parseTduDelivery(text: string): number | undefined {
  // "TDU Delivery Charges: 3.891¢ per kWh"  – often varies by TDSP
  const re = /TDU.*?(?:delivery|pass[-\s]*through).*?([0-9]+(?:\.[0-9]+)?)\s*(?:¢|cents?)\s*\/?\s*kWh/i;
  const m = re.exec(text);
  if (!m) return;
  const v = parseFloat(m[1]!);
  return isFinite(v) ? v : undefined;
}

function parseTerm(text: string): number | undefined {
  const re = /\b(?:Term|Contract\s*term)\b[^0-9]{0,10}(\d{1,3})\s*(?:months?|mo)\b/i;
  const m = re.exec(text);
  if (!m) return;
  const v = parseInt(m[1]!, 10);
  return isFinite(v) ? v : undefined;
}

function parseCancelFee(text: string): string | undefined {
  // "$150 early termination fee" or "$15/month remaining"
  const m1 = /(\$[0-9]+(?:\.[0-9]{2})?)\s*(?:early|cancell?ation)\s*(?:termination\s*)?fee/i.exec(text);
  if (m1) return m1[1];
  const m2 = /\$([0-9]+)\s*\/\s*month\s*remaining/i.exec(text);
  if (m2) return `$${m2[1]}/month remaining`;
  return;
}

export async function fetchAndParseEfl(url: string): Promise<FetchedEfl> {
  const res1 = await fetchBuffer(url);

  // If HTML viewer, try to find a direct PDF link first
  if (!isPdfContentType(res1.contentType)) {
    const { text: htmlText, $ } = await extractHtmlText(res1.buf);

    // Heuristic: find first <a href="...pdf">
    let pdfHref: string | undefined;
    $('a[href]').each((_, el) => {
      const href = ($(el).attr('href') || '').trim();
      if (href.toLowerCase().includes('.pdf') && !pdfHref) pdfHref = href;
    });

    if (pdfHref) {
      // Resolve relative links
      try {
        const pdfUrl = new URL(pdfHref, res1.finalUrl).toString();
        const res2 = await fetchBuffer(pdfUrl);
        if (isPdfContentType(res2.contentType)) {
          const pdfText = await extractPdfText(res2.buf);
          const checksum = crypto.createHash('sha256').update(pdfText).digest('hex');
          const parsed = parseEflText(pdfText);
          return {
            url,
            finalUrl: res2.finalUrl,
            contentType: res2.contentType,
            text: pdfText,
            isPdf: true,
            checksum,
            parsed,
          };
        }
      } catch {
        // fall through to parse HTML text directly
      }
    }

    // Parse HTML text fallback
    const checksum = crypto.createHash('sha256').update(htmlText).digest('hex');
    const parsed = parseEflText(htmlText);
    return {
      url,
      finalUrl: res1.finalUrl,
      contentType: res1.contentType,
      text: htmlText,
      isPdf: false,
      checksum,
      parsed,
    };
  }

  // Direct PDF
  const pdfText = await extractPdfText(res1.buf);
  const checksum = crypto.createHash('sha256').update(pdfText).digest('hex');
  const parsed = parseEflText(pdfText);
  return {
    url,
    finalUrl: res1.finalUrl,
    contentType: res1.contentType,
    text: pdfText,
    isPdf: true,
    checksum,
    parsed,
  };
}

export function parseEflText(text: string): ParsedEfl {
  const notes: string[] = [];

  const baseMonthlyFeeCents = parseBaseMonthlyFee(text);
  if (baseMonthlyFeeCents != null) notes.push(`Base monthly fee detected: ${baseMonthlyFeeCents}¢`);

  const tduDeliveryCentsPerKwh = parseTduDelivery(text);
  if (tduDeliveryCentsPerKwh != null) notes.push(`TDU delivery: ${tduDeliveryCentsPerKwh}¢/kWh`);

  const centsPerKwhBands = parseBandsByKwh(text);
  if (centsPerKwhBands?.length) notes.push(`Found ${centsPerKwhBands.length} energy bands`);

  const usageCredits = parseUsageCredit(text);
  if (usageCredits?.length) notes.push(`Found ${usageCredits.length} usage credit rule(s)`);

  const termMonths = parseTerm(text);
  if (termMonths != null) notes.push(`Term: ${termMonths} months`);

  const cancelFee = parseCancelFee(text);
  if (cancelFee) notes.push(`Cancel fee: ${cancelFee}`);

  const { avgPrice500, avgPrice1000, avgPrice2000 } = parseAvgPrices(text);

  // TODO: TOU windows (Free Nights/Weekends) — add more patterns as you encounter them.
  const touWindows: ParsedTouWindow[] | undefined = undefined;

  // Other common fees (best-effort initial regex)
  const otherFees: Record<string, any> = {};

  const minUsageFee = /minimum\s+usage\s+fee[^$0-9]{0,20}\$?\s*([0-9]+(?:\.[0-9]{1,2})?)/i.exec(text);
  if (minUsageFee) {
    otherFees.minimumUsageFeeCents = centsFromDollarsLike(minUsageFee[1]!);
    notes.push(`Minimum usage fee found`);
  }

  const depositMayApply = /deposit\s+may\s+be\s+required/i.test(text);
  if (depositMayApply) otherFees.depositMayBeRequired = true;

  return {
    baseMonthlyFeeCents,
    tduDeliveryCentsPerKwh,
    centsPerKwhBands,
    usageCredits,
    touWindows,
    otherFees: Object.keys(otherFees).length ? otherFees : undefined,
    termMonths,
    cancelFee,
    avgPrice500,
    avgPrice1000,
    avgPrice2000,
    notes: notes.length ? notes : undefined,
  };
}

// Helper to prepare a Prisma update object for RateConfig from ParsedEfl
export function toRateConfigUpdate(parsed: ParsedEfl) {
  return {
    baseMonthlyFeeCents: parsed.baseMonthlyFeeCents ?? undefined,
    tduDeliveryCentsPerKwh: parsed.tduDeliveryCentsPerKwh ?? undefined,
    centsPerKwhJson: parsed.centsPerKwhBands ? (parsed.centsPerKwhBands as any) : undefined,
    billCreditsJson: parsed.usageCredits ? (parsed.usageCredits as any) : undefined,
    touWindowsJson: parsed.touWindows ? (parsed.touWindows as any) : undefined,
    otherFeesJson: parsed.otherFees ? (parsed.otherFees as any) : undefined,
    notes: parsed.notes?.join(' • '),
  };
}
