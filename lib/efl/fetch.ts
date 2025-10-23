// lib/efl/fetch.ts
// Step 17: EFL fetcher — download EFL (PDF or HTML), extract readable text for parsing.
// - Tries PDF first (via pdfjs) when content-type hints at PDF or when URL ends with .pdf
// - Falls back to HTML/text scraping if not a PDF.
// - Normalizes whitespace and returns { text, contentType, bytes, fromPdf }
//
// Note: pdfjs is dynamically imported on the server to keep the bundle slim.

import crypto from 'crypto';

export type FetchedEfl = {
  text: string;           // normalized text (UTF-8)
  contentType: string;    // response content-type (best guess)
  bytes: number;          // raw payload size
  fromPdf: boolean;       // true if parsed via pdfjs
  hash: string;           // sha256 of raw payload (useful for change detection)
};

const PDF_HINT_RE = /\.pdf(?:$|\?)/i;

export async function fetchEflText(eflUrl: string, opts?: { timeoutMs?: number }): Promise<FetchedEfl> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), opts?.timeoutMs ?? 15000);

  try {
    const res = await fetch(eflUrl, {
      method: 'GET',
      redirect: 'follow',
      // Some EFL viewers require a reasonable UA
      headers: {
        'user-agent':
          'Mozilla/5.0 (compatible; IntelliWatt-EFLFetcher/1.0; +https://intelliwatt.com)',
        accept:
          'application/pdf, text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      },
      signal: controller.signal,
      cache: 'no-store',
    });

    // Content-Type
    let ctype = (res.headers.get('content-type') || '').toLowerCase();

    // Buffer it (we need bytes for pdf sniff & hashing)
    const buf = new Uint8Array(await res.arrayBuffer());
    const bytes = buf.byteLength;
    const hash = sha256Hex(buf);

    // Heuristic: treat as PDF if header says so OR URL ends with .pdf OR first bytes look like %PDF
    const isPdfHeader = ctype.includes('application/pdf');
    const isPdfUrl = PDF_HINT_RE.test(eflUrl);
    const isPdfMagic = bytes >= 4 && String.fromCharCode(buf[0], buf[1], buf[2], buf[3]) === '%PDF';

    if (isPdfHeader || isPdfUrl || isPdfMagic) {
      const text = await pdfToText(buf);
      return {
        text: normalizeWhitespace(text),
        contentType: ctype || 'application/pdf',
        bytes,
        fromPdf: true,
        hash,
      };
    }

    // Otherwise assume text/HTML
    const text = new TextDecoder('utf-8', { fatal: false, ignoreBOM: true }).decode(buf);
    const plain = htmlToText(text);
    // Update content-type if server was vague
    if (!ctype) ctype = text.trim().startsWith('<') ? 'text/html' : 'text/plain';

    return {
      text: normalizeWhitespace(plain),
      contentType: ctype,
      bytes,
      fromPdf: false,
      hash,
    };
  } finally {
    clearTimeout(timeout);
  }
}

// ------------------------ internals ------------------------

async function pdfToText(buf: Uint8Array): Promise<string> {
  // Lazy-load pdfjs to avoid bundling on edge/client
  // Use the legacy build which works nicely in Node runtimes.
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  // Some environments need the worker disabled or set to a dummy
  // @ts-ignore
  pdfjs.GlobalWorkerOptions.workerSrc = pdfjs.GlobalWorkerOptions.workerSrc || '';

  const loadingTask = pdfjs.getDocument({ data: buf });
  const pdf = await loadingTask.promise;

  let out = '';
  const meta = await pdf.getMetadata().catch(() => null);
  if (meta?.info?.Title) out += `Title: ${meta.info.Title}\n`;

  const maxPages = Math.min(pdf.numPages, 200); // safety cap
  for (let i = 1; i <= maxPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    const text = content.items
      .map((it: any) => ('str' in it ? it.str : it?.toString?.() ?? ''))
      .join(' ');
    out += '\n' + text;
  }
  try {
    await pdf.destroy();
  } catch {}
  return out;
}

function htmlToText(html: string): string {
  // Remove scripts/styles
  const noScript = html.replace(/<script[\s\S]*?<\/script>/gi, '').replace(/<style[\s\S]*?<\/style>/gi, '');
  // Replace <br> with newlines
  const withBreaks = noScript.replace(/<br\s*\/?>/gi, '\n');
  // Strip tags
  const stripped = withBreaks.replace(/<\/?[^>]+>/g, ' ');
  // Decode a few common HTML entities
  return decodeEntities(stripped);
}

function decodeEntities(s: string): string {
  const map: Record<string, string> = {
    '&nbsp;': ' ',
    '&amp;': '&',
    '&lt;': '<',
    '&gt;': '>',
    '&#39;': "'",
    '&quot;': '"',
  };
  return s.replace(/(&nbsp;|&amp;|&lt;|&gt;|&#39;|&quot;)/g, (m) => map[m] || m);
}

function normalizeWhitespace(s: string): string {
  return s.replace(/\r/g, '\n').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
}

function sha256Hex(u8: Uint8Array): string {
  const h = crypto.createHash('sha256');
  h.update(u8);
  return h.digest('hex');
}
