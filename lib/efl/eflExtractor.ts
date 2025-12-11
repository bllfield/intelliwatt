import crypto from "crypto";
import { Buffer } from "node:buffer";

/**
 * Result of deterministic EFL parsing before AI extraction.
 * This is *not* stored yet — DB integration will come later.
 */
export interface EflDeterministicExtract {
  /** SHA256 of the raw PDF bytes. */
  eflPdfSha256: string;

  /** Normalized full text extracted from the PDF. */
  rawText: string;

  /** REP’s PUCT certificate number, if found. */
  repPuctCertificate: string | null;

  /** Exact Ver. # string from the EFL (used as plan version identity). */
  eflVersionCode: string | null;

  /** Any parse warnings for missing or ambiguous fields. */
  warnings: string[];

  /** Which PDF text extraction method was used, if known. */
  extractorMethod?: "pdf-parse" | "pdfjs";
}

/**
 * Compute the SHA-256 hash of the PDF bytes.
 */
export function computePdfSha256(pdfBytes: Uint8Array | Buffer): string {
  return crypto.createHash("sha256").update(pdfBytes).digest("hex");
}

/**
 * Clean extracted text:
 *  - Normalize line breaks
 *  - Remove repeated headers/footers (basic)
 *  - Trim trailing whitespace
 *
 * More aggressive cleaning can be added later.
 */
function cleanExtractedText(text: string): string {
  return text.replace(/\r/g, "").replace(/[ \t]+\n/g, "\n").trim();
}

/**
 * Stub for PDF→text extraction.
 * The real implementation will use pdf-parse or a Python helper.
 * For now, caller injects the text directly to test the parser.
 */
export interface PdfTextExtractor {
  (pdfBytes: Uint8Array | Buffer): Promise<string>;
}

/**
 * Parse REP PUCT Certificate # from EFL text.
 * Looks for patterns like:
 *  - "PUCT Certificate # 10260"
 *  - "PUCT Certificate No. 10260"
 */
function extractRepPuctCertificate(rawText: string): string | null {
  const match = rawText.match(/PUCT\s+Certificate\s*(#|No\.?)\s*([A-Za-z0-9]+)/i);
  return match ? match[2].trim() : null;
}

/**
 * Parse the EFL "Ver. #:" line.
 * Example:
 *  Ver. #: Free Nights 36_ONC_U_1205_995_15_09052025
 */
function extractEflVersionCode(rawText: string): string | null {
  const match = rawText.match(/Ver\.\s*#:\s*(.+)/i);
  if (!match) return null;

  const value = match[1].split("\n")[0].trim();
  return value.length > 0 ? value : null;
}

/**
 * Extract text from a PDF with a two-stage fallback:
 *  1) pdf-parse
 *  2) pdfjs-dist text extraction
 *
 * Returns the extracted text, the method used, and any warnings.
 */
async function extractPdfTextWithFallback(
  pdfBytes: Uint8Array | Buffer,
): Promise<{
  rawText: string;
  extractorMethod: "pdf-parse" | "pdfjs";
  warnings: string[];
}> {
  const warnings: string[] = [];

  // --- Strict binary / glyph detection helper ---
  function looksBinary(rawText: string): boolean {
    if (!rawText) return true;

    // 1) PDF header → definitely not extracted text
    if (rawText.startsWith("%PDF-")) return true;

    // 2) Printable character ratio (ASCII 0x20-0x7E)
    let printableCount = 0;
    for (let i = 0; i < rawText.length; i++) {
      const ch = rawText[i];
      if (ch >= " " && ch <= "~") {
        printableCount++;
      }
    }
    const ratio = printableCount / rawText.length;

    // If less than 60% printable, treat as binary/glyph noise
    return ratio < 0.6;
  }

  // Ensure DOMMatrix polyfill is available before any pdf.js-based work,
  // including the internal pdf.js that pdf-parse relies on.
  if (typeof (globalThis as any).DOMMatrix === "undefined") {
    (globalThis as any).DOMMatrix = class DOMMatrixPolyfill {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      constructor(..._args: any[]) {}
    } as any;
  }

  // --- Primary: pdf-parse ---
  let primaryText = "";
  try {
    const pdfParseModule = await import("pdf-parse");
    const pdfParseFn: any =
      (pdfParseModule as any).default || (pdfParseModule as any);
    const result = await pdfParseFn(
      Buffer.isBuffer(pdfBytes) ? pdfBytes : Buffer.from(pdfBytes),
    );
    primaryText =
      (result && typeof result.text === "string" ? result.text : "") || "";
  } catch (err) {
    warnings.push(
      `pdf-parse failed: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
    primaryText = "";
  }

  primaryText = primaryText.trim();

  // If pdf-parse output is clearly readable, use it.
  if (!looksBinary(primaryText)) {
    return {
      rawText: primaryText,
      extractorMethod: "pdf-parse",
      warnings,
    };
  }

  // --- Fallback: pdfjs-dist text extraction ---
  try {
    // Dynamically import the legacy pdf.js build only when needed so that
    // routes that never hit this fallback do not pay the cost or risk
    // module initialization issues at load time.
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore - pdfjs-dist legacy build has no bundled types for this entry
    const pdfjsLib: any = await import("pdfjs-dist/legacy/build/pdf");

    // Ensure pdf.js always receives a plain Uint8Array, never a Node Buffer subclass.
    const uint8: Uint8Array =
      Buffer.isBuffer(pdfBytes)
        ? new Uint8Array(pdfBytes) // Buffer -> Uint8Array
        : pdfBytes instanceof Uint8Array
          ? pdfBytes
          : new Uint8Array(pdfBytes as ArrayLike<number>);

    // Hard-disable workers in serverless/Node so we don't need a pdf.worker.mjs chunk.
    if (pdfjsLib.GlobalWorkerOptions) {
      pdfjsLib.GlobalWorkerOptions.workerSrc = "";
      (pdfjsLib.GlobalWorkerOptions as any).workerPort = null;
    }
    (pdfjsLib as any).disableWorker = true;

    const loadingTask = pdfjsLib.getDocument({
      data: uint8,
      disableWorker: true,
    });

    const doc = await loadingTask.promise;
    const numPages: number = doc.numPages;
    const textChunks: string[] = [];

    for (let pageNum = 1; pageNum <= numPages; pageNum++) {
      const page = await doc.getPage(pageNum);
      const content = await page.getTextContent();
      const items: any[] = (content as any).items ?? [];
      const pageText = items
        .map((item) => {
          if (item && typeof item.str === "string") return item.str;
          if ("str" in item && typeof (item as any).str === "string") {
            return (item as any).str;
          }
          return "";
        })
        .join(" ");

      if (pageText && pageText.trim().length > 0) {
        textChunks.push(pageText);
      }
    }

    const combined = textChunks.join("\n").trim();

    if (combined && !looksBinary(combined)) {
      warnings.push("pdfjs fallback succeeded after binary-looking pdf-parse output.");
      return {
        rawText: combined,
        extractorMethod: "pdfjs",
        warnings,
      };
    }

    warnings.push(
      "pdfjs fallback attempted but still produced unreadable/binary-looking text.",
    );
  } catch (err) {
    warnings.push(
      `pdfjs-dist text extraction failed: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
  }

  // If we reach here, no meaningful text was extracted.
  warnings.push(
    "PDF content appears binary/unreadable even after pdfjs fallback; no usable text available.",
  );

  return {
    rawText: "",
    // We attempted pdfjs fallback and still couldn't get usable text, so
    // report pdfjs here to reflect the last extractor tried.
    extractorMethod: "pdfjs",
    warnings,
  };
}

/**
 * Deterministic extraction pipeline (PDF → text → metadata).
 * This is Step 2 of the EFL Fact Card Engine build.
 */
export async function deterministicEflExtract(
  pdfBytes: Uint8Array | Buffer,
  extractPdfText?: PdfTextExtractor,
): Promise<EflDeterministicExtract> {
  const warnings: string[] = [];
  let extractorMethod: "pdf-parse" | "pdfjs" | undefined;

  const eflPdfSha256 = computePdfSha256(pdfBytes);

  let rawExtracted = "";
  if (extractPdfText) {
    // Legacy path: caller provides its own PDF→text extractor.
    rawExtracted = await extractPdfText(pdfBytes);
  } else {
    const fallbackResult = await extractPdfTextWithFallback(pdfBytes);
    rawExtracted = fallbackResult.rawText;
    extractorMethod = fallbackResult.extractorMethod;
    if (fallbackResult.warnings.length > 0) {
      warnings.push(...fallbackResult.warnings);
    }
  }

  const rawText = cleanExtractedText(rawExtracted);

  const repPuctCertificate = extractRepPuctCertificate(rawText);
  if (!repPuctCertificate) {
    warnings.push("Missing REP PUCT Certificate number.");
  }

  const eflVersionCode = extractEflVersionCode(rawText);
  if (!eflVersionCode) {
    warnings.push("Missing EFL Ver. # version code.");
  }

  return {
    eflPdfSha256,
    rawText,
    repPuctCertificate,
    eflVersionCode,
    warnings,
    extractorMethod,
  };
}
