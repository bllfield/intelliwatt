import crypto from "crypto";
import { Buffer } from "node:buffer";
// @ts-expect-error pdfjs-dist legacy build has no bundled types for this entry
import * as pdfjsLib from "pdfjs-dist/legacy/build/pdf";

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

  const trimmedPrimary = primaryText.trim();
  const looksBinaryOrEmpty =
    trimmedPrimary.startsWith("%PDF-") ||
    trimmedPrimary.replace(/\s+/g, "").length < 32;

  if (!looksBinaryOrEmpty && trimmedPrimary.length > 0) {
    return {
      rawText: primaryText,
      extractorMethod: "pdf-parse",
      warnings,
    };
  }

  // --- Fallback: pdfjs-dist text extraction ---
  try {
    const loadingTask = (pdfjsLib as any).getDocument({
      data: Buffer.isBuffer(pdfBytes) ? pdfBytes : Buffer.from(pdfBytes),
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
    if (combined.length > 0) {
      warnings.push(
        "pdf-parse output looked binary or empty; pdfjs-dist was used as a fallback.",
      );
      return {
        rawText: combined,
        extractorMethod: "pdfjs",
        warnings,
      };
    }

    warnings.push("pdfjs-dist fallback produced no text.");
  } catch (err) {
    warnings.push(
      `pdfjs-dist text extraction failed: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
  }

  // If we reach here, no better text was extracted; return whatever we have from pdf-parse.
  return {
    rawText: primaryText || "",
    extractorMethod: "pdf-parse",
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

  // Some pdf.js builds expect a DOMMatrix global, which is not available in the
  // Node.js runtime used by our API routes. Provide a minimal no-op polyfill
  // so text extraction can proceed without crashing.
  if (typeof (globalThis as any).DOMMatrix === "undefined") {
    (globalThis as any).DOMMatrix = class DOMMatrixPolyfill {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      constructor(..._args: any[]) {}
    } as any;
  }

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

