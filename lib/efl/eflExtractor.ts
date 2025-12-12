import crypto from "crypto";
import { Buffer } from "node:buffer";
import { execFile } from "node:child_process";
import os from "node:os";
import fs from "node:fs/promises";
import path from "node:path";

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
  extractorMethod?: "pdf-parse" | "pdfjs" | "pdftotext";
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

async function runPdftotext(pdfBytes: Uint8Array | Buffer): Promise<string> {
  const rawUrl = process.env.EFL_PDFTEXT_URL;
  const rawToken = process.env.EFL_PDFTEXT_TOKEN ?? "";

  // Normalize token: trim whitespace and strip wrapping quotes, if any.
  let token = rawToken.trim();
  if (
    (token.startsWith('"') && token.endsWith('"')) ||
    (token.startsWith("'") && token.endsWith("'"))
  ) {
    token = token.slice(1, -1);
  }

  if (!rawUrl) {
    throw new Error(
      "EFL_PDFTEXT_URL is not configured; pdftotext fallback is disabled. " +
        "This value must be an HTTPS URL on a publicly reachable hostname (no direct :8095). " +
        "In production, set EFL_PDFTEXT_URL to https://efl-pdftotext.intelliwatt.com/efl/pdftotext " +
        "(see docs/runbooks/EFL_PDFTEXT_PROXY_NGINX.md).",
    );
  }

  const serviceUrl = rawUrl.trim();

  // Warn loudly (via error text) if still pointed directly at :8095 over http,
  // which is not reachable from Vercel in production and should never be used
  // from browsers or serverless functions. We surface this through the normal
  // pdftotext fallback warning path.
  if (serviceUrl.startsWith("http://") && serviceUrl.includes(":8095")) {
    throw new Error(
      `EFL_PDFTEXT_URL appears to point at ${serviceUrl}, which uses plain http and a non-standard port (8095). ` +
        "Vercel cannot reach this directly, and plain http should not be used for PDF uploads. " +
        "Configure an nginx HTTPS proxy on the droplet that terminates TLS for efl-pdftotext.intelliwatt.com " +
        "and proxy_passes to http://127.0.0.1:8095/efl/pdftotext, then set " +
        "EFL_PDFTEXT_URL=https://efl-pdftotext.intelliwatt.com/efl/pdftotext.",
    );
  }

  const buffer = Buffer.isBuffer(pdfBytes) ? pdfBytes : Buffer.from(pdfBytes);

  // Preferred path: call remote pdftotext microservice (e.g., droplet helper)
  // via HTTPS proxy, so production does not depend on a local binary being
  // present in Vercel. If that fails (e.g., droplet unreachable in local dev),
  // fall back to a local `pdftotext` CLI if available.
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 25_000);

  try {
    const resp = await fetch(serviceUrl, {
      method: "POST",
      headers: {
        // Send raw PDF bytes; the droplet helper reads the body as-is.
        "content-type": "application/pdf",
        ...(token ? { "X-EFL-PDFTEXT-TOKEN": token } : {}),
      },
      body: buffer as unknown as BodyInit,
      signal: controller.signal,
    });

    if (!resp.ok) {
      let bodyText = "";
      try {
        bodyText = await resp.text();
      } catch {
        bodyText = "";
      }
      const snippet = bodyText.slice(0, 500);
      throw new Error(
        `pdftotext service HTTP ${resp.status} ${resp.statusText || ""} body=${snippet}`.trim(),
      );
    }

    let data: any;
    try {
      data = await resp.json();
    } catch (err) {
      throw new Error(
        `pdftotext service returned non-JSON response: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }

    if (!data || data.ok !== true || typeof data.text !== "string") {
      const msg =
        (data && typeof data.error === "string" && data.error) ||
        "unexpected pdftotext service payload";
      throw new Error(msg);
    }

    return data.text;
  } catch (err) {
    const remoteMsg = err instanceof Error ? err.message : String(err);

    // Fallback: try local pdftotext binary if available (useful for local dev).
    const tmpDir = os.tmpdir();
    const tmpPath = path.join(
      tmpDir,
      `efl-${Date.now()}-${Math.random().toString(16).slice(2)}.pdf`,
    );

    try {
      await fs.writeFile(tmpPath, buffer);

      const cliText = await new Promise<string>((resolve, reject) => {
        execFile(
          "pdftotext",
          ["-layout", "-enc", "UTF-8", tmpPath, "-"],
          (cliErr, stdout) => {
            void fs.unlink(tmpPath).catch(() => {});
            if (cliErr) return reject(cliErr);
            resolve(stdout.toString());
          },
        );
      });

      return cliText;
    } catch (cliErr) {
      const cliMsg =
        cliErr instanceof Error ? cliErr.message : String(cliErr);
      throw new Error(
        `pdftotext service fetch to ${serviceUrl} failed: ${remoteMsg}; ` +
          `local pdftotext fallback failed: ${cliMsg}`,
      );
    }
  } finally {
    clearTimeout(timeout);
  }
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
 * Extract text from a PDF using the droplet `pdftotext` helper only.
 *
 * We intentionally bypass pdf-parse and pdfjs for EFL work to avoid flaky
 * glyph output and focus solely on the canonical pdftotext pipeline.
 */
async function extractPdfTextWithFallback(
  pdfBytes: Uint8Array | Buffer,
): Promise<{
  rawText: string;
  extractorMethod: "pdftotext";
  warnings: string[];
}> {
  const warnings: string[] = [];

  try {
    const pdftotextOutput = (await runPdftotext(pdfBytes)).trim();

    if (pdftotextOutput) {
      return {
        rawText: pdftotextOutput,
        extractorMethod: "pdftotext",
        warnings,
      };
    }

    warnings.push("pdftotext returned empty text.");
  } catch (err) {
    warnings.push(
      `pdftotext fallback failed: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
  }

  return {
    rawText: "",
    extractorMethod: "pdftotext",
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
  let extractorMethod: "pdftotext" | undefined;

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

  const result: EflDeterministicExtract = {
    eflPdfSha256,
    rawText,
    repPuctCertificate,
    eflVersionCode,
    warnings,
  };

  // Only include extractorMethod when we actually know which extractor was used;
  // in the legacy path where a custom extractPdfText is provided, this remains
  // undefined and is therefore omitted from the returned object.
  if (extractorMethod) {
    (result as any).extractorMethod = extractorMethod;
  }

  return result;
}