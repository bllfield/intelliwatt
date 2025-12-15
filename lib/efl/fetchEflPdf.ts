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
  return (
    buf.byteLength >= 4 &&
    String.fromCharCode(buf[0], buf[1], buf[2], buf[3]) === "%PDF"
  );
}

function pickEflPdfUrlFromHtml(html: string, baseUrl: string): string | null {
  // 1) Prefer an anchor whose inner text contains "Electricity Facts Label".
  const anchorRe =
    /<a\b[^>]*\bhref\s*=\s*["']([^"']+)["'][^>]*>([\s\S]{0,400}?)<\/a>/gi;

  let bestHref: string | null = null;

  let m: RegExpExecArray | null;
  while ((m = anchorRe.exec(html))) {
    const href = m[1] || "";
    const inner = normalizeSpace(stripTags(m[2] || ""));
    if (!href) continue;

    const isEflText =
      /electricity\s+facts\s+label/i.test(inner) ||
      /\bEFL\b/i.test(inner) ||
      /facts\s+label/i.test(inner);

    if (isEflText) {
      bestHref = href;
      break;
    }
  }

  // 2) Fallback: any PDF-ish href that contains "efl" in the URL.
  if (!bestHref) {
    anchorRe.lastIndex = 0;
    while ((m = anchorRe.exec(html))) {
      const href = m[1] || "";
      if (!href) continue;
      const resolved = resolveUrl(baseUrl, href);
      if (!resolved) continue;
      if (PDF_HINT_RE.test(resolved) && /efl/i.test(resolved)) {
        bestHref = href;
        break;
      }
    }
  }

  // 3) Last resort: first .pdf href anywhere.
  if (!bestHref) {
    const pdfHrefRe = /\bhref\s*=\s*["']([^"']+\.pdf[^"']*)["']/i;
    const mm = html.match(pdfHrefRe);
    if (mm?.[1]) bestHref = mm[1];
  }

  if (!bestHref) return null;
  return resolveUrl(baseUrl, bestHref);
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

    const resolvedPdfUrl = pickEflPdfUrlFromHtml(html, res.url || eflUrl);
    if (!resolvedPdfUrl) {
      return {
        ok: false,
        error:
          "EFL URL did not return a PDF, and no 'Electricity Facts Label' PDF link was found on the page.",
        notes: [
          ...notes,
          `contentType=${contentType ?? "unknown"}`,
          `finalUrl=${res.url || eflUrl}`,
        ],
      };
    }

    notes.push("Resolved EFL PDF link from landing page HTML.");

    const second = await fetchBytes(resolvedPdfUrl, timeoutMs);
    if (!second.res.ok) {
      return {
        ok: false,
        error: `Resolved EFL PDF fetch failed: HTTP ${second.res.status} ${second.res.statusText}`.trim(),
        notes: [...notes, `resolvedPdfUrl=${resolvedPdfUrl}`],
      };
    }

    const secondCtype = (second.contentType ?? "").toLowerCase();
    const secondIsPdf =
      secondCtype.includes("application/pdf") || sniffPdf(second.buf);
    if (!secondIsPdf) {
      return {
        ok: false,
        error:
          "Resolved EFL link did not return a PDF (unexpected content-type/body).",
        notes: [
          ...notes,
          `resolvedPdfUrl=${resolvedPdfUrl}`,
          `resolvedContentType=${second.contentType ?? "unknown"}`,
        ],
      };
    }

    return {
      ok: true,
      pdfUrl: second.res.url || resolvedPdfUrl,
      pdfBytes: Buffer.from(second.buf),
      source: "HTML_RESOLVED",
      contentType: second.contentType,
      notes: [...notes, `resolvedPdfUrl=${resolvedPdfUrl}`],
    };
  } catch (err) {
    return {
      ok: false,
      error: `EFL fetch failed: ${err instanceof Error ? err.message : String(err)}`,
      notes,
    };
  }
}


