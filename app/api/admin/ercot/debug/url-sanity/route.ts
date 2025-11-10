import { NextResponse } from 'next/server';
import { resolveLatestFromPage } from '@/lib/ercot/resolve';
import { JSDOM } from 'jsdom';

export const dynamic = 'force-dynamic';

export async function GET() {
  const pageUrl = process.env.ERCOT_PAGE_URL;
  const filter = process.env.ERCOT_PAGE_FILTER || 'TDSP';
  
  if (!pageUrl) return NextResponse.json({ ok: false, error: 'MISSING_ERCOT_PAGE_URL' }, { status: 500 });
  
  try {
    const res = await fetch(pageUrl, { 
      headers: { 'user-agent': 'IntelliWattBot/1.0 (+https://intelliwatt.com)' } 
    });
    
    if (!res.ok) {
      return NextResponse.json({ 
        ok: false, 
        error: 'FETCH_FAILED', 
        status: res.status,
        statusText: res.statusText,
        pageUrl 
      }, { status: 500 });
    }
    
    const html = await res.text();
    const dom = new JSDOM(html);
    const anchors = Array.from(dom.window.document.querySelectorAll('a[href]')) as HTMLAnchorElement[];
    const allLinks = anchors.map(a => a.href).filter(Boolean);
    
    // Diagnostic: find all TDSP/ESIID links
    const tdspEsiidLinks = allLinks.filter(href => {
      const lower = href.toLowerCase();
      return lower.includes('tdsp') && lower.includes('esiid');
    });
    
    // Apply filter
    const filtered = tdspEsiidLinks.filter(href => 
      href.toUpperCase().includes(filter.toUpperCase())
    );
    
    const candidates = await resolveLatestFromPage(pageUrl);
    
    return NextResponse.json({ 
      ok: true, 
      pageUrl,
      filter,
      stats: {
        totalLinks: allLinks.length,
        tdspEsiidLinks: tdspEsiidLinks.length,
        filteredLinks: filtered.length,
        candidatesReturned: candidates.length
      },
      sampleTdspEsiidLinks: tdspEsiidLinks.slice(0, 5),
      sampleFilteredLinks: filtered.slice(0, 5),
      candidates 
    });
  } catch (e: any) {
    return NextResponse.json({ 
      ok: false, 
      error: 'RESOLVE_ERROR', 
      message: e?.message || String(e),
      pageUrl 
    }, { status: 500 });
  }
}

