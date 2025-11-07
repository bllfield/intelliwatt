import { fetchText } from '@/lib/ercot/http';

/**
 * Resolve the latest public "mirDownload?doclookupId=..." link from an ERCOT product page.
 */
export async function resolveLatestErcotUrl(pageUrl: string, filter?: string): Promise<{ url: string; matches: string[] }> {
  const html = await fetchText(pageUrl, { headers: { 'User-Agent': process.env.ERCOT_USER_AGENT || 'IntelliWattBot/1.0' } });

  const hrefs = Array.from(html.matchAll(/href\s*=\s*["']([^"']*mirDownload\?[^"']*doclookupId=[^"']+)["']/gi))
    .map((m) => m[1])
    .map((href) => (href.startsWith('http') ? href : new URL(href, pageUrl).toString()));

  const candidates: string[] = [];
  for (const href of hrefs) {
    const snippetRegex = new RegExp(`(.{0,160}${escapeRegex(href)}.{0,160})`, 'i');
    const snippet = html.match(snippetRegex)?.[1] || '';
    if (!filter) {
      if (/TDSP|ESIID/i.test(snippet)) {
        candidates.push(href);
      }
    } else if (new RegExp(escapeRegex(filter), 'i').test(snippet)) {
      candidates.push(href);
    }
  }

  const picks = candidates.length ? candidates : hrefs;
  if (!picks.length) {
    throw new Error('No mirDownload links found on ERCOT page.');
  }

  return { url: picks[0], matches: picks };
}

function escapeRegex(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
