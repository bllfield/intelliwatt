import { Buffer } from "node:buffer";

export type FetchEflPdfResult =
  | {
      ok: true;
      pdfUrl: string;
      pdfBytes: Buffer;
      source: "DIRECT_PDF" | "HTML_RESOLVED";
      contentType: string | null;
      notes: string[];
    }
  | {
      ok: false;
      error: string;
      notes: string[];
    };

const PDF_HINT_RE = /\.pdf(?:$|\?)/i;

function decodeEntities(s: string): string {
  const map: Record<string, string> = {
    "&nbsp;": " ",
    "&amp;": "&",
    "&lt;": "<",
    "&gt;": ">",
    "&#39;": "'",
    "&quot;": '"',
  };
  return s.replace(
    /(&nbsp;|&amp;|&lt;|&gt;|&#39;|&quot;)/g,
    (m) => map[m] || m,
  );
}

function stripTags(html: string): string {
  return html.replace(/<\/?[^>]+>/g, " ");
}

function normalizeSpace(s: string): string {
  return decodeEntities(s).replace(/\s+/g, " ").trim();
}

function resolveUrl(baseUrl: string, href: string): string | null {
  try {
    return new URL(href, baseUrl).toString();
  } catch {
    return null;
  }
}

function sniffPdf(buf: Uint8Array): boolean {
  if (!buf || buf.byteLength < 4) return false;

  // Some servers prepend whitespace or a UTF-8 BOM before the PDF header.
  // Be tolerant: skip BOM + ASCII whitespace, then also scan a small prefix.
  let i = 0;
  if (
    buf.byteLength >= 3 &&
    buf[0] === 0xef &&
    buf[1] === 0xbb &&
    buf[2] === 0xbf
  ) {
    i = 3;
  }
  while (i < buf.byteLength) {
    const b = buf[i];
    if (b === 0x09 || b === 0x0a || b === 0x0d || b === 0x20) {
      i++;
      continue;
    }
    break;
  }
  if (i + 4 <= buf.byteLength) {
    if (
      String.fromCharCode(buf[i], buf[i + 1], buf[i + 2], buf[i + 3]) === "%PDF"
    ) {
      return true;
    }
  }

  // Fallback: scan the first 2KB for the magic bytes (handles odd wrappers / redirects).
  const max = Math.min(buf.byteLength - 4, 2048);
  for (let j = 0; j <= max; j++) {
    if (buf[j] === 0x25 && buf[j + 1] === 0x50 && buf[j + 2] === 0x44 && buf[j + 3] === 0x46) {
      return true;
    }
  }
  return false;
}

function scoreCandidate(args: {
  url: string;
  hintText: string;
  kind: "a" | "iframe" | "embed" | "object" | "meta";
}): number {
  const u = args.url.toLowerCase();
  const t = args.hintText.toLowerCase();
  let score = 0;

  if (PDF_HINT_RE.test(u)) score += 100;
  if (args.kind !== "a") score += 20;
  if (u.includes("efl")) score += 50;
  if (u.includes("facts") && u.includes("label")) score += 40;
  if (u.includes("electricity") && u.includes("facts")) score += 40;

  if (t.includes("electricity facts label")) score += 80;
  if (/\befl\b/.test(t)) score += 60;
  if (t.includes("facts label")) score += 50;
  if (t.includes("download")) score += 10;

  return score;
}

function extractFirstAttr(attrs: string, name: string): string | null {
  const re = new RegExp(
    String.raw`\b${name}\s*=\s*(?:"([^"]+)"|'([^']+)'|([^\s>]+))`,
    "i",
  );
  const m = attrs.match(re);
  const v = (m?.[1] ?? m?.[2] ?? m?.[3] ?? "").trim();
  return v ? v : null;
}

function extractUrlsFromJs(s: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const re =
    /(https?:\/\/[^"'\\\s<>]+|\/[^"'\\\s<>]+)\.pdf(?:\?[^"'\\\s<>]*)?/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s))) {
    const u = (m[0] || "").trim();
    if (!u || seen.has(u)) continue;
    seen.add(u);
    out.push(u);
  }
  return out;
}

function extractQuotedUrlsFromText(s: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const re = /["'](https?:\/\/[^"']+|\/[^"']+)["']/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s))) {
    const u = (m[1] || "").trim();
    if (!u || seen.has(u)) continue;
    seen.add(u);
    out.push(u);
  }
  return out;
}

function looksLikeEflDocUrl(u: string): boolean {
  const s = u.toLowerCase();
  return (
    PDF_HINT_RE.test(s) ||
    s.includes("electricity") && s.includes("facts") ||
    s.includes("facts") && s.includes("label") ||
    s.includes("/home/efl") ||
    s.includes("efl") ||
    // SmartGridCIS/OhmConnect doc host uses a non-.pdf download endpoint.
    (s.includes("/documents/download.aspx") && s.includes("productdocumentid="))
  );
}

function pickEflPdfCandidateUrlsFromHtml(html: string, baseUrl: string): string[] {
  const candidates: Array<{ url: string; score: number }> = [];
  const seen = new Set<string>();

  const push = (rawUrl: string, hintText: string, kind: "a" | "iframe" | "embed" | "object" | "meta") => {
    const resolved = resolveUrl(baseUrl, rawUrl);
    if (!resolved) return;
    if (seen.has(resolved)) return;
    seen.add(resolved);
    candidates.push({
      url: resolved,
      score: scoreCandidate({ url: resolved, hintText, kind }),
    });
  };

  // 0) meta refresh (some pages redirect to the actual PDF via <meta http-equiv="refresh">)
  const metaRefreshRe =
    /<meta\b[^>]*http-equiv\s*=\s*["']refresh["'][^>]*content\s*=\s*["'][^"']*url\s*=\s*([^"';\s]+)[^"']*["'][^>]*>/gi;
  let mm: RegExpExecArray | null;
  while ((mm = metaRefreshRe.exec(html))) {
    const href = (mm[1] || "").trim();
    if (href) push(href, "meta refresh", "meta");
  }

  // 0b) Direct PDF URLs embedded in scripts/JSON. (Common on React/Next landing pages.)
  // Prefer those that appear close to an "Electricity Facts Label" label.
  const labelWindowRe =
    /Electricity\s*Facts\s*Label[\s\S]{0,1200}?((https?:\/\/[^"'\\\s<>]+|\/[^"'\\\s<>]+)\.pdf(?:\?[^"'\\\s<>]*)?)/gi;
  while ((mm = labelWindowRe.exec(html))) {
    const raw = (mm[1] || "").trim();
    if (raw) push(raw, "Electricity Facts Label (nearby url)", "meta");
  }

  // 0c) Script/JSON extraction (common for Next.js/React landing pages).
  // Pull out any quoted URLs that look like EFL docs (pdf or /Home/EFl or contains efl),
  // regardless of whether they appear right next to the label.
  const scriptRe = /<script\b[^>]*>([\s\S]{0,120000}?)<\/script>/gi;
  while ((mm = scriptRe.exec(html))) {
    const body = mm[1] || "";
    for (const u of extractQuotedUrlsFromText(body)) {
      if (looksLikeEflDocUrl(u)) push(u, "script url", "meta");
    }
  }

  // 1) anchors
  const anchorRe = /<a\b([^>]*)>([\s\S]{0,800}?)<\/a>/gi;
  let m: RegExpExecArray | null;
  while ((m = anchorRe.exec(html))) {
    const attrs = m[1] || "";
    const href =
      extractFirstAttr(attrs, "href") ??
      extractFirstAttr(attrs, "data-href") ??
      extractFirstAttr(attrs, "data-url") ??
      extractFirstAttr(attrs, "data-downloadurl") ??
      null;
    if (!href) continue;

    const inner = normalizeSpace(stripTags(m[2] || ""));
    const aria = extractFirstAttr(attrs, "aria-label");
    const title = extractFirstAttr(attrs, "title");
    const hint = normalizeSpace([inner, aria, title].filter(Boolean).join(" "));
    push(href, hint, "a");
  }

  // 1b) buttons / onclick handlers that open a PDF URL (common for "Download" links)
  const buttonRe = /<(button|div)\b([^>]*?)>/gi;
  while ((m = buttonRe.exec(html))) {
    const tag = (m[1] || "").toLowerCase();
    const attrs = m[2] || "";
    const aria = extractFirstAttr(attrs, "aria-label") ?? "";
    const title = extractFirstAttr(attrs, "title") ?? "";
    const onclick = extractFirstAttr(attrs, "onclick") ?? "";
    const dataHref =
      extractFirstAttr(attrs, "data-href") ??
      extractFirstAttr(attrs, "data-url") ??
      extractFirstAttr(attrs, "data-downloadurl") ??
      null;

    const hint = normalizeSpace([aria, title, onclick].filter(Boolean).join(" "));

    if (dataHref) {
      push(dataHref, `${tag} ${hint}`.trim(), "a");
    }

    if (onclick) {
      // Try .pdf first, but also capture non-.pdf EFL endpoints (e.g. /Home/EFl?...)
      const urls = [
        ...extractUrlsFromJs(onclick),
        ...extractQuotedUrlsFromText(onclick).filter(looksLikeEflDocUrl),
      ];
      for (const u of urls) push(u, `${tag} onclick ${hint}`.trim(), "a");
    }
  }

  // 2) iframe/embed/object common PDF containers
  const iframeRe = /<iframe\b[^>]*\bsrc\s*=\s*["']([^"']+)["'][^>]*>/gi;
  while ((m = iframeRe.exec(html))) {
    const src = (m[1] || "").trim();
    if (src) push(src, "iframe", "iframe");
  }

  const embedRe = /<embed\b[^>]*\bsrc\s*=\s*["']([^"']+)["'][^>]*>/gi;
  while ((m = embedRe.exec(html))) {
    const src = (m[1] || "").trim();
    if (src) push(src, "embed", "embed");
  }

  const objectRe = /<object\b[^>]*\bdata\s*=\s*["']([^"']+)["'][^>]*>/gi;
  while ((m = objectRe.exec(html))) {
    const data = (m[1] || "").trim();
    if (data) push(data, "object", "object");
  }

  // Prefer higher scores first.
  candidates.sort((a, b) => b.score - a.score);
  return candidates.map((c) => c.url);
}

// Exported for unit tests (keep the networked fetch tests lightweight).
export function __pickEflPdfCandidateUrlsFromHtmlForTest(html: string, baseUrl: string): string[] {
  return pickEflPdfCandidateUrlsFromHtml(html, baseUrl);
}

async function fetchBytes(url: string, timeoutMs: number) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: "GET",
      redirect: "follow",
      headers: {
        // Some WAFs block "compatible; bot" user agents. Prefer a normal browser UA.
        "user-agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36",
        accept:
          "application/pdf,text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "accept-language": "en-US,en;q=0.9",
      },
      cache: "no-store",
      signal: controller.signal,
    });
    const contentType = res.headers.get("content-type");
    const buf = new Uint8Array(await res.arrayBuffer());
    return { res, contentType, buf };
  } finally {
    clearTimeout(timeout);
  }
}

function originFromUrl(u: string): string | null {
  try {
    return new URL(u).origin;
  } catch {
    return null;
  }
}

async function fetchBytesWithHeaders(args: {
  url: string;
  timeoutMs: number;
  headers: Record<string, string>;
}): Promise<{ res: Response; contentType: string | null; buf: Uint8Array }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), args.timeoutMs);
  try {
    const res = await fetch(args.url, {
      method: "GET",
      redirect: "follow",
      headers: args.headers,
      cache: "no-store",
      signal: controller.signal,
    });
    const contentType = res.headers.get("content-type");
    const buf = new Uint8Array(await res.arrayBuffer());
    return { res, contentType, buf };
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchRedirectLocation(args: {
  url: string;
  timeoutMs: number;
  headers: Record<string, string>;
}): Promise<{ status: number; location: string | null; resUrl: string }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), args.timeoutMs);
  try {
    const res = await fetch(args.url, {
      method: "GET",
      // IMPORTANT: we want to read the Location header ourselves.
      redirect: "manual",
      headers: args.headers,
      cache: "no-store",
      signal: controller.signal,
    });
    const location = res.headers.get("location");
    return { status: res.status, location, resUrl: res.url || args.url };
  } finally {
    clearTimeout(timeout);
  }
}

function baseHeaders(profile: "browser" | "bot" | "none"): Record<string, string> {
  if (profile === "none") return {};
  if (profile === "bot") {
    // Older hosts sometimes allow a friendly/explicit bot UA.
    return {
      "user-agent":
        "Mozilla/5.0 (compatible; IntelliWatt-EFLFetcher/1.0; +https://intelliwatt.com)",
      accept:
        "application/pdf,text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "accept-language": "en-US,en;q=0.9",
    };
  }
  // browser
  return {
    "user-agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36",
    accept:
      "application/pdf,text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "accept-language": "en-US,en;q=0.9",
  };
}

function withReferer(headers: Record<string, string>, referer: string): Record<string, string> {
  return { ...headers, referer };
}

function refererVariantsForOrigin(origin: string, finalUrl?: string | null): string[] {
  const out: string[] = [];
  out.push(`${origin}/`);
  out.push(`${origin}/Documents/`);
  if (finalUrl) out.push(finalUrl);
  return Array.from(new Set(out));
}

function isShortlinkHost(u: string): boolean {
  try {
    const host = new URL(u).hostname.toLowerCase();
    return (
      host === "bit.ly" ||
      host === "t.co" ||
      host === "tinyurl.com" ||
      host === "rb.gy" ||
      host === "is.gd" ||
      host === "ow.ly"
    );
  } catch {
    return false;
  }
}

async function resolveShortlinkFinalUrl(args: {
  url: string;
  timeoutMs: number;
  notes: string[];
}): Promise<string | null> {
  const { url, timeoutMs, notes } = args;
  if (!isShortlinkHost(url)) return null;

  // Use conservative headers (browser) for the redirect resolver.
  const headers = baseHeaders("browser");

  let cur = url;
  for (let hop = 0; hop < 6; hop++) {
    notes.push(`shortlink_resolve_hop=${hop}`);
    let r: { status: number; location: string | null; resUrl: string };
    try {
      r = await fetchRedirectLocation({ url: cur, timeoutMs, headers });
    } catch (e) {
      notes.push(`shortlink_resolve_error=${e instanceof Error ? e.message : String(e)}`);
      return null;
    }

    // Not a redirect response (or no Location) → stop.
    if (!(r.status >= 300 && r.status < 400) || !r.location) {
      // Some shortlinks may respond 200 and rely on HTML/JS redirect; our main fetcher handles that.
      return null;
    }

    const next = resolveUrl(cur, r.location);
    if (!next) return null;

    notes.push(`shortlink_resolved_to=${next}`);
    cur = next;

    // If we’re no longer on a shortlink host, return the resolved URL.
    if (!isShortlinkHost(cur)) return cur;
  }

  return null;
}

async function fetchWithProfilesAndReferer(args: {
  url: string;
  timeoutMs: number;
  notes: string[];
}): Promise<{ res: Response; contentType: string | null; buf: Uint8Array }> {
  const { url, timeoutMs, notes } = args;
  const profiles: Array<"browser" | "none" | "bot"> = ["browser", "none", "bot"];

  let last: { res: Response; contentType: string | null; buf: Uint8Array } | null = null;

  for (const profile of profiles) {
    const headers0 = baseHeaders(profile);
    notes.push(`fetch_profile=${profile}`);

    try {
      last = await fetchBytesWithHeaders({ url, timeoutMs, headers: headers0 });
    } catch (e) {
      notes.push(`fetch_error=${e instanceof Error ? e.message : String(e)}`);
      continue;
    }

    if (last.res.ok) return last;

    // Retry with referer for the starting URL origin.
    if (last.res.status === 403 || last.res.status === 406) {
      const origin = originFromUrl(url);
      if (origin) {
        for (const ref of refererVariantsForOrigin(origin)) {
          notes.push(`retry_with_referer=${ref}`);
          try {
            const attempt = await fetchBytesWithHeaders({
              url,
              timeoutMs,
              headers: withReferer(headers0, ref),
            });
            last = attempt;
            if (attempt.res.ok) return attempt;
          } catch (e) {
            notes.push(
              `referer_retry_error=${e instanceof Error ? e.message : String(e)}`,
            );
          }
        }
      }
    }

    // If redirected to a different host and still blocked, retry the final URL with same-origin referer variants.
    if (last.res.status === 403 || last.res.status === 406) {
      const finalUrl = last.res.url || url;
      const finalOrigin = originFromUrl(finalUrl);
      const startOrigin = originFromUrl(url);
      if (finalOrigin && finalUrl !== url && finalOrigin !== startOrigin) {
        for (const ref of refererVariantsForOrigin(finalOrigin, finalUrl)) {
          notes.push(`retry_final_url_with_referer=${ref}`);
          try {
            const attempt = await fetchBytesWithHeaders({
              url: finalUrl,
              timeoutMs,
              headers: withReferer(headers0, ref),
            });
            last = attempt;
            if (attempt.res.ok) return attempt;
          } catch (e) {
            notes.push(
              `final_referer_retry_error=${e instanceof Error ? e.message : String(e)}`,
            );
          }
        }
      }
    }
  }

  if (last) return last;

  // Should be unreachable, but keep things safe.
  return await fetchBytes(url, timeoutMs);
}

/**
 * Fetch an EFL PDF for a WattBuy docs.efl URL.
 *
 * Handles both:
 * - Direct PDFs
 * - “Landing pages” (HTML) that contain an "Electricity Facts Label" link to the PDF
 */
export async function fetchEflPdfFromUrl(
  eflUrl: string,
  opts?: { timeoutMs?: number },
): Promise<FetchEflPdfResult> {
  const notes: string[] = [];
  const timeoutMs = opts?.timeoutMs ?? 20_000;

  try {
    // If the input URL is a shortlink, resolve it first and then fetch the final URL directly.
    // This avoids sending requests to the final doc host via a redirect chain (some WAFs treat that as suspicious).
    const resolvedShortlink =
      (await resolveShortlinkFinalUrl({ url: eflUrl, timeoutMs, notes })) ?? null;
    const fetchUrl = resolvedShortlink ?? eflUrl;
    if (resolvedShortlink) notes.push(`shortlink_fetch_direct=${fetchUrl}`);

    const first = await fetchWithProfilesAndReferer({ url: fetchUrl, timeoutMs, notes });

    const { res, contentType, buf } = first;
    if (!res.ok) {
      return {
        ok: false,
        error: `Failed to fetch EFL URL: HTTP ${res.status} ${res.statusText}`.trim(),
        notes: [...notes, `finalUrl=${res.url || fetchUrl}`],
      };
    }

    const ctype = (contentType ?? "").toLowerCase();
    const isPdf =
      ctype.includes("application/pdf") || PDF_HINT_RE.test(eflUrl) || sniffPdf(buf);

    if (isPdf) {
      if (!ctype.includes("pdf") && sniffPdf(buf)) {
        notes.push("PDF detected via magic bytes (Content-Type was not pdf).");
      }
      return {
        ok: true,
        pdfUrl: res.url || fetchUrl,
        pdfBytes: Buffer.from(buf),
        source: "DIRECT_PDF",
        contentType,
        notes,
      };
    }

    // Otherwise, treat as HTML (landing page) and look for EFL PDF link.
    const html = new TextDecoder("utf-8", {
      fatal: false,
      ignoreBOM: true,
    }).decode(buf);

    const finalUrl = res.url || fetchUrl;
    const candidates = pickEflPdfCandidateUrlsFromHtml(html, finalUrl);
    if (!candidates.length) {
      return {
        ok: false,
        error:
          "EFL URL did not return a PDF, and no 'Electricity Facts Label' PDF link was found on the page.",
        notes: [
          ...notes,
          `contentType=${contentType ?? "unknown"}`,
          `finalUrl=${finalUrl}`,
        ],
      };
    }

    notes.push(
      `Landing page HTML: found ${candidates.length} candidate link(s).`,
    );

    // Try top candidates (some "EFL" links do not end in .pdf, but still return PDF bytes).
    const maxTries = Math.min(6, candidates.length);
    for (let i = 0; i < maxTries; i++) {
      const candidateUrl = candidates[i];
      try {
        const second = await fetchBytes(candidateUrl, timeoutMs);
        if (!second.res.ok) {
          notes.push(
            `candidate[${i}] HTTP ${second.res.status} for ${candidateUrl}`,
          );
          continue;
        }

        const secondCtype = (second.contentType ?? "").toLowerCase();
        const secondIsPdf =
          secondCtype.includes("application/pdf") || sniffPdf(second.buf);
        if (!secondIsPdf) {
          notes.push(
            `candidate[${i}] not pdf (contentType=${second.contentType ?? "unknown"}) url=${candidateUrl}`,
          );
          continue;
        }

        notes.push(`Resolved EFL PDF via candidate[${i}] from landing page.`);
        return {
          ok: true,
          pdfUrl: second.res.url || candidateUrl,
          pdfBytes: Buffer.from(second.buf),
          source: "HTML_RESOLVED",
          contentType: second.contentType,
          notes: [...notes, `resolvedPdfUrl=${candidateUrl}`],
        };
      } catch (e) {
        notes.push(
          `candidate[${i}] fetch failed: ${e instanceof Error ? e.message : String(e)}`,
        );
      }
    }

    return {
      ok: false,
      error:
        "EFL URL did not return a PDF, and none of the resolved landing-page candidates returned a PDF.",
      notes: [
        ...notes,
        `contentType=${contentType ?? "unknown"}`,
        `finalUrl=${finalUrl}`,
        `candidatesTried=${maxTries}`,
        `candidate0=${candidates[0]}`,
      ],
    };
  } catch (err) {
    return {
      ok: false,
      error: `EFL fetch failed: ${err instanceof Error ? err.message : String(err)}`,
      notes,
    };
  }
}


