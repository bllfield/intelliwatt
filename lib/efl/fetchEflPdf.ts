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
        "user-agent":
          "Mozilla/5.0 (compatible; IntelliWatt-EFLFetcher/1.0; +https://intelliwatt.com)",
        accept:
          "application/pdf, text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
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
    const { res, contentType, buf } = await fetchBytes(eflUrl, timeoutMs);
    if (!res.ok) {
      return {
        ok: false,
        error: `Failed to fetch EFL URL: HTTP ${res.status} ${res.statusText}`.trim(),
        notes,
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
        pdfUrl: res.url || eflUrl,
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

    const finalUrl = res.url || eflUrl;
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


