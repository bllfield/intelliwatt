import crypto from "crypto";

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
 * Deterministic extraction pipeline (PDF → text → metadata).
 * This is Step 2 of the EFL Fact Card Engine build.
 */
export async function deterministicEflExtract(
  pdfBytes: Uint8Array | Buffer,
  extractPdfText: PdfTextExtractor,
): Promise<EflDeterministicExtract> {
  const warnings: string[] = [];

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

  const rawExtracted = await extractPdfText(pdfBytes);
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
  };
}

