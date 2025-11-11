// lib/ercot/fetchDaily.ts

import * as cheerio from "cheerio";

export type ErcotFile = {
  tdsp: string;              // e.g. ONCOR_ELEC___DAILY
  href: string;              // absolute URL to .zip
  filename: string;          // derived from href
  postedAt: Date;            // parsed from "Posted"
};

function toAbs(base: string, rel: string) {
  try {
    return new URL(rel, base).toString();
  } catch {
    return rel;
  }
}

export async function scrapeLatestDailyList(ercotPageUrl: string): Promise<{ postedAt: Date; files: ErcotFile[] }> {
  const res = await fetch(ercotPageUrl, { cache: "no-store" });
  if (!res.ok) throw new Error(`ERCOT page fetch failed: ${res.status}`);
  const html = await res.text();
  const $ = cheerio.load(html);

  // The page shows a table with rows for each TDSP. We need:
  // - Friendly Name text (LUBBOCK______DAILY, etc.)
  // - Posted timestamp
  // - <a href="...zip"> links
  // We'll gather all rows, group by Posted date, and pick the newest Posted.
  type Row = { tdsp: string; posted: Date; hrefs: string[] };

  const rows: Row[] = [];

  $('table,div').each((_, el) => {
    const text = $(el).text() || '';
    if (!/DAILY/i.test(text)) return;
  });

  // A defensive parse: find any anchor to .zip, walk up to a row/container that also shows "Posted".
  const zipAnchors = $('a[href$=".zip"]');
  zipAnchors.each((_, a) => {
    const href = $(a).attr('href')!;
    const container = $(a).closest('tr').length ? $(a).closest('tr') : $(a).closest('div,section,li');
    const tdspCell = container?.find('td,div,span').filter((_, c) => /DAILY/i.test($(c).text())).first();
    const tdsp = (tdspCell?.text() || '').trim().split(/\s+/)[0] || 'UNKNOWN_DAILY';

    // Find a sibling text containing "Posted"
    let postedText = '';
    container?.find('td,div,span').each((_, c) => {
      const t = $(c).text();
      if (/posted/i.test(t)) postedText = t;
    });
    // Fallback: scan whole container text
    if (!postedText) {
      const t = container?.text() || '';
      const m = t.match(/Posted[^0-9]*([\d/:\sAPMapm-]+)/);
      if (m) postedText = m[0];
    }
    // Parse a date (UTC naive → Date)
    let posted: Date | null = null;
    const dmatch = (postedText.match(/\d{1,2}\/\d{1,2}\/\d{4}[^0-9]*\d{1,2}:\d{2}:\d{2}\s*(AM|PM)?/i))
                || (postedText.match(/\d{1,2}\/\d{1,2}\/\d{4}/));
    if (dmatch) posted = new Date(dmatch[0]);

    // Aggregate
    const abs = toAbs(ercotPageUrl, href);
    const filename = abs.split('/').pop() || `ercot_${tdsp}.zip`;
    const row = rows.find(r => r.tdsp === tdsp && r.posted?.getTime() === posted?.getTime());
    if (row) row.hrefs.push(abs);
    else if (posted) rows.push({ tdsp, posted, hrefs: [abs] });
  });

  if (!rows.length) throw new Error('No DAILY zip links found on ERCOT page.');

  // Choose the newest "Posted" date
  rows.sort((a,b) => b.posted.getTime() - a.posted.getTime());
  const latestPosted = rows[0].posted;
  const sameDay = rows.filter(r => r.posted.getTime() === latestPosted.getTime());

  // For each TDSP row, keep first zip (usually there's one per TDSP per day)
  const files = sameDay.flatMap(row => row.hrefs.slice(0,1).map(h => ({
    tdsp: row.tdsp,
    href: h,
    filename: h.split('/').pop() || `${row.tdsp}.zip`,
    postedAt: row.posted
  })));

  // Ensure we got the six expected sets if present on page; we'll still proceed with whatever we find.
  return { postedAt: latestPosted, files };
}

export async function downloadZip(url: string): Promise<Uint8Array> {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`Download failed ${res.status}: ${url}`);
  const buf = new Uint8Array(await res.arrayBuffer());
  if (buf.byteLength < 100) throw new Error(`Downloaded too small (${buf.byteLength} bytes) from ${url}`);
  return buf;
}

