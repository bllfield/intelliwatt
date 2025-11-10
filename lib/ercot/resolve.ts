import { JSDOM } from 'jsdom';
import crypto from 'node:crypto';

const DEFAULT_FILTER = process.env.ERCOT_PAGE_FILTER ?? 'TDSP';
const DEFAULT_UA = process.env.ERCOT_USER_AGENT ?? 'IntelliWattBot/1.0 (+https://intelliwatt.com)';

export async function resolveLatestFromPage(pageUrl: string) {
  const res = await fetch(pageUrl, { headers: { 'user-agent': DEFAULT_UA } });
  const html = await res.text();
  const dom = new JSDOM(html);
  const anchors = Array.from(dom.window.document.querySelectorAll('a[href]')) as HTMLAnchorElement[];
  const links = anchors
    .map(a => a.href)
    .filter(href => href && href.toLowerCase().includes('tdsp') && href.toLowerCase().includes('esiid'))
    .filter(href => href.toUpperCase().includes(DEFAULT_FILTER.toUpperCase()));

  // Pick the last link (assumes page lists newest first or includes date in URL)
  const candidates = links.slice(-3); // keep a few
  return candidates;
}

// Legacy compatibility - keep for existing code
export async function resolveLatestFromPageLegacy(pageUrl: string, filter: string | null, userAgent?: string) {
  const candidates = await resolveLatestFromPage(pageUrl);
  const base = new URL(pageUrl);
  const absolute = candidates.map(href => new URL(href, base).toString());
  absolute.sort();
  const latest = absolute[absolute.length - 1] || null;
  return { latest, candidates: absolute };
}

export function sha256buf(buf: Buffer) {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

