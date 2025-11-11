// lib/ercot/fetchDaily.ts

import * as cheerio from "cheerio";
import { getErcotIdToken } from "./auth";

export type ErcotFile = {
  tdsp: string;       // e.g. ONCOR_ELEC___DAILY
  href: string;       // absolute URL to .zip
  filename: string;   // derived from href
  postedAt: Date;     // UTC
};

const PRODUCT_ID = process.env.ERCOT_PRODUCT_ID || 'ZP15-612'; // Keep original case (API may be case-sensitive)

function toAbs(base: string, rel: string) {
  try { return new URL(rel, base).toString(); } catch { return rel; }
}

export async function getLatestDailyFiles(ercotPageUrl: string): Promise<{ postedAt: Date; files: ErcotFile[] }> {
  const subKey = process.env.ERCOT_SUBSCRIPTION_KEY;

  // Prefer API mode whenever subscription key is present; fetch fresh id_token each run.
  if (subKey) {
    try {
      const idToken = await getErcotIdToken();
      const root = 'https://api.ercot.com/api/public-reports';
      const commonHeaders = {
        'Ocp-Apim-Subscription-Key': subKey,
        'Authorization': `Bearer ${idToken}`,
        'Accept': 'application/json',
      } as const;

      // Try multiple endpoint strategies:
      // 1. Direct archive endpoint
      // 2. Product endpoint to get archive link
      // 3. Products list to find correct product ID (by name/description matching TDSP ESIID)
      
      let archiveHref = `${root}/archive/${PRODUCT_ID}`;
      let archRes = await fetch(archiveHref, { headers: commonHeaders, cache: 'no-store' });

      // If archive endpoint fails, try product endpoint
      if (!archRes.ok && archRes.status === 404) {
        const productUrl = `${root}/${PRODUCT_ID}`;
        const prodRes = await fetch(productUrl, { headers: commonHeaders, cache: 'no-store' });
        if (prodRes.ok) {
          const prod = await prodRes.json();
          archiveHref = prod?._links?.archive?.href || archiveHref;
          archRes = await fetch(archiveHref, { headers: commonHeaders, cache: 'no-store' });
        } else {
          // Query products list to find TDSP ESIID product
          const productsListUrl = `${root}`;
          const listRes = await fetch(productsListUrl, { headers: commonHeaders, cache: 'no-store' });
          if (listRes.ok) {
            const listJson = await listRes.json().catch(() => null);
            const products: any[] = listJson?._embedded?.products || listJson?.products || [];
            // Look for TDSP ESIID product (case-insensitive search with multiple strategies)
            const tdspProduct = products.find((p: any) => {
              const name = (p.name || '').toUpperCase();
              const desc = (p.description || '').toUpperCase();
              const emilId = (p.emilId || '').toUpperCase();
              // Strategy 1: Exact emilId match
              if (emilId === PRODUCT_ID.toUpperCase() || emilId === 'ZP15-612') return true;
              // Strategy 2: TDSP + ESIID in name/description
              if (name.includes('TDSP') && (name.includes('ESIID') || name.includes('ESI ID') || name.includes('EXTRACT'))) return true;
              if (desc.includes('TDSP') && (desc.includes('ESIID') || desc.includes('ESI ID') || desc.includes('EXTRACT'))) return true;
              // Strategy 3: Look for "ZP15" in emilId (might be different format)
              if (emilId.includes('ZP15') || emilId.includes('ZP-15')) return true;
              // Strategy 4: Look for "DAILY" + "TDSP" or "DAILY" + "EXTRACT"
              if ((name.includes('DAILY') || desc.includes('DAILY')) && (name.includes('TDSP') || name.includes('EXTRACT') || desc.includes('TDSP') || desc.includes('EXTRACT'))) return true;
              return false;
            });
            
            if (tdspProduct?.emilId) {
              // Found the product, use its emilId
              const correctEmilId = tdspProduct.emilId;
              archiveHref = `${root}/archive/${correctEmilId}`;
              archRes = await fetch(archiveHref, { headers: commonHeaders, cache: 'no-store' });
            }
          }
        }
      }

      // If API succeeded, process the response
      if (archRes.ok) {
        const archiveJson = await archRes.json();
        const artifacts: any[] = archiveJson?._embedded?.artifacts || archiveJson?.artifacts || [];

        if (!artifacts.length) throw new Error('ERCOT API returned no artifacts for this product');

        artifacts.sort((a, b) => new Date(b.postDateTime).getTime() - new Date(a.postDateTime).getTime());

        const latestPost = artifacts[0]?.postDateTime ? new Date(artifacts[0].postDateTime) : null;
        if (!latestPost) throw new Error('ERCOT API artifacts missing postDateTime');

        const sameDay = artifacts.filter(a => new Date(a.postDateTime).getTime() === latestPost.getTime());

        const files: ErcotFile[] = sameDay
          .filter(a =>
            (a.fileName || '').toLowerCase().endsWith('.zip') ||
            (a._links?.download?.href || '').toLowerCase().endsWith('.zip')
          )
          .map(a => {
            const href = a._links?.download?.href || a.downloadUrl || '';
            const filename = (a.fileName || href.split('/').pop() || '').trim();
            const display = (a.displayName || filename || '').toUpperCase();
            const tdspGuess = (display.match(/ONCOR|CENTERPOINT|AEP[_\s]?NORTH|AEP[_\s]?CENTRAL|TNMP|LUBBOCK/i)?.[0] || 'UNKNOWN')
              .replace(/\s+/g, '_')
              .replace(/__+/g, '_')
              .toUpperCase();

            const tdsp = tdspGuess.includes('AEP_NORTH') ? 'AEP_NORTH____DAILY'
                      : tdspGuess.includes('AEP_CENTRAL') ? 'AEP_CENTRAL__DAILY'
                      : tdspGuess.includes('CENTERPOINT') ? 'CENTERPOINT__DAILY'
                      : tdspGuess.includes('ONCOR') ? 'ONCOR_ELEC___DAILY'
                      : tdspGuess.includes('TNMP') ? 'TNMP_________DAILY'
                      : tdspGuess.includes('LUBBOCK') ? 'LUBBOCK______DAILY'
                      : tdspGuess;

            return { tdsp, href, filename, postedAt: latestPost! };
          });

        if (!files.length) throw new Error('ERCOT API returned artifacts but none looked like .zip');

        return { postedAt: latestPost!, files };
      }
      // If API failed, fall through to HTML scraping (don't throw error yet)
      console.warn(`ERCOT API: Product '${PRODUCT_ID}' not found in API. Falling back to HTML scraping.`);
    } catch (apiError: any) {
      // API mode failed, fall through to HTML scraping
      console.warn(`ERCOT API error: ${apiError?.message || String(apiError)}. Falling back to HTML scraping.`);
    }
  }

  // --- HTML FALLBACK (best-effort) ---
  const res = await fetch(ercotPageUrl, { 
    cache: "no-store",
    headers: {
      'User-Agent': process.env.ERCOT_USER_AGENT || 'IntelliWattBot/1.0 (+https://intelliwatt.com)',
    }
  });
  if (!res.ok) throw new Error(`ERCOT page fetch failed: ${res.status}`);
  const html = await res.text();
  const $ = cheerio.load(html);
  
  // Check if page is a login page
  const pageText = $('body').text().toLowerCase();
  if (pageText.includes('log in') || pageText.includes('login') || pageText.includes('sign in')) {
    throw new Error(`ERCOT page appears to be a login page. The page may require authentication or the URL (${ercotPageUrl}) may be incorrect. Please verify ERCOT_PAGE_URL points to the public data product page.`);
  }

  // Try multiple selectors for zip links
  let anchors = $('a[href*=".zip"]');
  if (anchors.length === 0) {
    // Try case-insensitive search
    anchors = $('a').filter((_, el) => {
      const href = $(el).attr('href') || '';
      return href.toLowerCase().includes('.zip');
    });
  }
  if (anchors.length === 0) {
    // Try looking for any link with "tdsp" and "esiid" in the href or text
    anchors = $('a').filter((_, el) => {
      const href = $(el).attr('href') || '';
      const text = $(el).text() || '';
      const combined = (href + ' ' + text).toLowerCase();
      return combined.includes('tdsp') && (combined.includes('esiid') || combined.includes('esi id') || combined.includes('extract'));
    });
  }

  const rows: Array<{ tdsp: string; postedAt: Date; href: string; filename: string }> = [];

  anchors.each((_, a) => {
    const href = toAbs(ercotPageUrl, $(a).attr('href') || '');
    if (!href || !href.toLowerCase().includes('.zip')) return;
    
    const filename = href.split('/').pop() || 'file.zip';
    const container = $(a).closest('tr').length ? $(a).closest('tr') : $(a).closest('div,section,li,td');
    const contextText = container?.text() || $(a).text() || $('body').text() || '';

    const tdsp = (contextText.match(/(ONCOR|CENTERPOINT|AEP[\s_]*NORTH|AEP[\s_]*CENTRAL|TNMP|LUBBOCK)[\w_\s-]*DAILY/i)?.[0]
      || contextText.match(/ONCOR|CENTERPOINT|AEP[\s_]*NORTH|AEP[\s_]*CENTRAL|TNMP|LUBBOCK/i)?.[0]
      || filename.match(/(ONCOR|CENTERPOINT|AEP[\s_]*NORTH|AEP[\s_]*CENTRAL|TNMP|LUBBOCK)/i)?.[0]
      || 'UNKNOWN_DAILY')
      .toUpperCase()
      .replace(/\s+/g, '_');

    const postMatch = contextText.match(/(\d{1,2}\/\d{1,2}\/\d{4}[^0-9]*\d{1,2}:\d{2}:\d{2}\s*(AM|PM)?)/i)
                    || contextText.match(/(\d{1,2}\/\d{1,2}\/\d{4})/);
    const postedAt = postMatch ? new Date(postMatch[1]) : new Date();

    rows.push({ tdsp, postedAt, href, filename });
  });

  if (!rows.length) {
    // Provide more diagnostic info
    const allLinks = $('a[href]').length;
    const zipLinks = $('a[href*=".zip"], a[href*=".ZIP"]').length;
    const pageText = $('body').text().slice(0, 500);
    throw new Error(`No DAILY zip links found on ERCOT page (HTML fallback). Found ${allLinks} total links, ${zipLinks} zip links. Page preview: ${pageText}...`);
  }

  rows.sort((a,b) => b.postedAt.getTime() - a.postedAt.getTime());
  const latest = rows[0].postedAt;
  const files = rows
    .filter(r => r.postedAt.getTime() === latest.getTime())
    .map(r => ({ tdsp: r.tdsp, href: r.href, filename: r.filename, postedAt: r.postedAt }));

  return { postedAt: latest, files };
}

export async function downloadZip(url: string): Promise<Uint8Array> {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`Download failed ${res.status}: ${url}`);
  const buf = new Uint8Array(await res.arrayBuffer());
  if (buf.byteLength < 100) throw new Error(`Downloaded too small (${buf.byteLength} bytes) from ${url}`);
  return buf;
}
