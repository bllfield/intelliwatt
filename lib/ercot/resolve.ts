import { JSDOM } from 'jsdom'

export async function resolveLatestFromPage(pageUrl: string, filter: string | null, userAgent?: string) {
  const res = await fetch(pageUrl, {
    headers: userAgent ? { 'user-agent': userAgent } : undefined,
    cache: 'no-store',
  })
  const text = await res.text()
  const dom = new JSDOM(text)
  const links = Array.from(dom.window.document.querySelectorAll('a'))
    .map(a => a.getAttribute('href'))
    .filter(Boolean) as string[]

  // Prefer obvious TDSP_ESIID_Extract files
  let candidates = links.filter(href =>
    /TDSP_ESIID_Extract/i.test(href || '')
  )

  if (filter && filter.trim().length > 0) {
    candidates = candidates.filter(h => h.toLowerCase().includes(filter.toLowerCase()))
  }

  // Absolute-ize relative links
  const base = new URL(pageUrl)
  const absolute = candidates.map(href => new URL(href, base).toString())

  // Best-effort: pick the lexicographically last (often newest by dated filename)
  absolute.sort()
  const latest = absolute[absolute.length - 1] || null
  return { latest, candidates: absolute }
}

