import { JSDOM } from 'jsdom';
import crypto from 'node:crypto';

const DEFAULT_FILTER = process.env.ERCOT_PAGE_FILTER ?? 'TDSP';
const DEFAULT_UA = process.env.ERCOT_USER_AGENT ?? 'IntelliWattBot/1.0 (+https://intelliwatt.com)';

export async function resolveLatestFromPage(pageUrl: string) {
  const res = await fetch(pageUrl, { headers: { 'user-agent': DEFAULT_UA } });
  if (!res.ok) {
    throw new Error(`Failed to fetch page: ${res.status} ${res.statusText}`);
  }
  const html = await res.text();
  const dom = new JSDOM(html);
  const anchors = Array.from(dom.window.document.querySelectorAll('a[href]')) as HTMLAnchorElement[];
  
  // Collect all links for debugging
  const allLinks = anchors.map(a => a.href).filter(Boolean);
  
  // Filter for TDSP ESIID links
  const tdspEsiidLinks = allLinks
    .filter(href => {
      const lower = href.toLowerCase();
      return lower.includes('tdsp') && lower.includes('esiid');
    });
  
  // Apply filter if specified
  const filtered = DEFAULT_FILTER
    ? tdspEsiidLinks.filter(href => href.toUpperCase().includes(DEFAULT_FILTER.toUpperCase()))
    : tdspEsiidLinks;

  // Pick the last few links (assumes page lists newest first or includes date in URL)
  const candidates = filtered.slice(-3);
  
  // If no candidates after filter, return all TDSP ESIID links for debugging
  if (candidates.length === 0 && tdspEsiidLinks.length > 0) {
    // Return all TDSP ESIID links so caller can see what was found
    return tdspEsiidLinks.slice(-3);
  }
  
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

