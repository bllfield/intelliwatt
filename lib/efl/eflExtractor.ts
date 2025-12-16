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
      // Best-effort cleanup if we failed before the execFile callback
      // had a chance to remove the temp file.
      void fs.unlink(tmpPath).catch(() => {});

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
 * Handles common forms like:
 *  - "PUCT Certificate No. 10004"
 *  - "PUCT Cert. #10027"
 * Returns the numeric certificate string (digits only) when found.
 */
function extractRepPuctCertificate(text: string): string | null {
  const re =
    /\b(?:PUCT\s*(?:Certificate\s*(?:No\.?|Number)?|Cert\.?|License)|REP\s*No\.)\s*[#:.\s]*([0-9]{4,6})\b/i;
  const m = text.match(re);
  return m?.[1] ?? null;
}

/**
 * Parse the EFL "Ver. #:" or "EFL Version" line.
 * Examples:
 *  - "EFL Ver. #: Free Nights 36_ONC_U_1205_995_15_09052025"
 *  - "Ver. #: 120725_UNB"
 *  - "EFL Version:" on one line, version code on the next non-empty line.
 */
function extractEflVersionCode(text: string): string | null {
  const lines = text.split(/\r?\n/).map((l) => l.trim());

  const normalizeToken = (s: string): string => {
    // Keep characters commonly seen in EFL version codes (including '+', which appears in some plan names).
    return s.replace(/^[^A-Z0-9+_.-]+/i, "").replace(/[^A-Z0-9+_.-]+$/i, "");
  };

  const isObviousJunkToken = (s: string): boolean => {
    const u = normalizeToken(s).toUpperCase();
    // Common footer split artifacts
    if (!u) return true;
    if (u === "ENGLISH" || u === "NGLISH" || u === "ISH") return true;
    if (u === "SPANISH" || u === "SP") return true;
    return false;
  };

  // Fail-closed: if we can't confidently extract a unique "Ver. #" token,
  // return null so downstream systems can queue it for review rather than
  // risk identity collisions (template overwrites).
  const isWeakVersionCandidate = (sRaw: string): boolean => {
    const s = normalizeToken(sRaw);
    if (!s) return true;
    if (isObviousJunkToken(s)) return true;
    const upper = s.toUpperCase();
    const digitCount = (s.match(/\d/g) ?? []).length;

    // Strong signal: explicit EFL_* tokens are generally safe.
    if (upper.includes("EFL_")) return false;

    // Allow simple version-number footers like "Version 10.0" handled earlier.
    // For everything else, require enough digits to be plausibly unique (dates/IDs).
    if (digitCount < 6) return true;

    // Reject language-tag fragments that still slip through with digits.
    if (/ENGLISH|SPANISH/i.test(upper)) return true;

    return false;
  };

  const scoreCandidate = (raw: string): number => {
    const s = normalizeToken(raw);
    if (!s) return -999;
    const u = s.toUpperCase();
    let score = 0;
    if (u.includes("EFL")) score += 50;
    const digitCount = (s.match(/\d/g) ?? []).length;
    if (digitCount >= 6) score += 25;
    if (digitCount >= 8) score += 10;
    if (s.includes("_")) score += 10;
    if (s.includes("-")) score += 2;
    if (s.includes("+")) score += 2;
    if (isObviousJunkToken(s)) score -= 100;
    score += Math.min(20, Math.floor(s.length / 4));
    return score;
  };

  const stitchWrapped = (parts: string[]): string | null => {
    const cleaned = parts.map((p) => normalizeToken(p)).filter(Boolean);
    if (!cleaned.length) return null;
    // If the first part looks like it ended mid-word and the next part is a small alpha suffix,
    // stitch it (e.g., "..._ENGL" + "ISH" => "..._ENGLISH").
    let out = cleaned[0];
    for (let i = 1; i < cleaned.length; i++) {
      const next = cleaned[i];
      if (!next) continue;
      const alphaOnly = /^[A-Z]+$/i.test(next);
      if (alphaOnly && next.length <= 6 && out.length >= 6) {
        out = `${out}${next}`;
        continue;
      }
      // Otherwise stop; we don't want to accidentally join unrelated footer lines.
      break;
    }
    return out || null;
  };

  // 0) Simple footer-style "Version 10.0" pattern.
  const footerVersion = text.match(
    /\bVersion\s+([0-9]+(?:\.[0-9]+)?)\b/i,
  );
  if (footerVersion?.[1]) {
    return `Version ${footerVersion[1]}`;
  }

  // A) Common inline "Ver. #:" patterns, with or without leading "EFL".
  // Some providers put a plan-family label on the Ver.# line and the unique
  // structured code on the next line (e.g., "Ver. #: GreenVolt" + "24_ONC_U_...").
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const m = line.match(/\b(?:EFL\s*)?Ver\.\s*#\s*:\s*(.+)\b/i);
    if (!m?.[1]) continue;

    const val = normalizeToken(m[1].trim());
    if (val && val.length >= 3 && !isWeakVersionCandidate(val)) return val;

    // If the inline token is weak (e.g. "GreenVolt"), try to find a strong
    // underscore token in the next few lines and combine them for uniqueness.
    const label = val || m[1].trim();
    const window: string[] = [];
    for (let j = i + 1; j < Math.min(i + 6, lines.length); j++) {
      const candidate = lines[j]?.trim();
      if (!candidate) continue;
      window.push(candidate);
      if (window.length >= 4) break;
    }
    if (!label || !window.length) continue;

    let strong: string | null = null;
    for (const w of window) {
      // Prefer the last underscore token on the line; these codes often appear
      // after "PUCT Certificate # #####" in footer layouts.
      const tokens = Array.from(w.matchAll(/\b([A-Z0-9_.-]*_[A-Z0-9_.-]+)\b/gi)).map((x) => x[1]);
      const best = tokens.length ? normalizeToken(tokens[tokens.length - 1]!) : null;
      if (!best) continue;
      if (!isWeakVersionCandidate(best)) {
        strong = best;
        break;
      }
    }
    if (strong) {
      const combined = `${label} ${strong}`.trim();
      // Combined string will include digits from the strong token, so it will
      // pass the weak-candidate guard unless it contains junk language fragments.
      if (!isWeakVersionCandidate(combined)) return combined;
      return combined;
    }
  }

  // A2) OhmConnect-style footer: "EFL Ref # TexasConnect 12 20251208E V1"
  // This appears at the bottom of many OhmConnect EFLs and functions as the effective label/version identifier.
  for (const line of lines) {
    const m = line.match(/\bEFL\s*Ref\s*#\s*(.+)$/i);
    if (m?.[1]) {
      const raw = m[1].trim();
      // Keep spaces for readability, but strip surrounding punctuation. (These are not underscore-style EFL_* tokens.)
      const cleaned = raw.replace(/^[^A-Z0-9]+/i, "").replace(/[^A-Z0-9]+$/i, "");
      // Require enough digits to avoid collisions; this usually includes a YYYYMMDD-like block + a version suffix.
      const digitCount = (cleaned.match(/\d/g) ?? []).length;
      if (cleaned && cleaned.length >= 8 && digitCount >= 6 && !isWeakVersionCandidate(cleaned)) {
        return cleaned;
      }
    }
  }

  // B) "EFL Version:" header with value either on the same line or the next
  // non-empty line.
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^EFL\s*Version\s*:?\s*$/i.test(line) || /^EFL\s*Version\s*:/i.test(line)) {
      // Same line value after colon
      const same = line.match(/^EFL\s*Version\s*:\s*(.+)$/i);
      if (same?.[1]) {
        const val = normalizeToken(same[1].trim());
        if (val && val.length >= 3 && !isWeakVersionCandidate(val)) return val;
      }

      // Next non-empty lines within a small window; choose best candidate (and try to stitch wraps).
      const window: string[] = [];
      for (let j = i + 1; j < Math.min(i + 8, lines.length); j++) {
        const candidate = lines[j]?.trim();
        if (!candidate) continue;
        window.push(candidate);
        if (window.length >= 4) break;
      }

      if (window.length) {
        // 1) Prefer any explicit EFL_* token in the window (stitching short suffixes).
        const stitched = stitchWrapped(window);
        if (stitched && /EFL_/i.test(stitched) && stitched.length >= 8) return stitched;

        // 2) Otherwise pick the highest-scoring single-line candidate.
        let best: string | null = null;
        let bestScore = -999;
        for (const cand of window) {
          const norm = normalizeToken(cand);
          const sc = scoreCandidate(norm);
          if (sc > bestScore) {
            bestScore = sc;
            best = norm;
          }
        }
        if (best && best.length >= 3 && !isWeakVersionCandidate(best)) return best;
      }
    }
  }

  // C) Fallback: standalone codes like "EFL_<...>" on any line.
  for (const line of lines) {
    // Allow + and - in case the plan name embeds them.
    const m = line.match(/\b(EFL_[A-Z0-9+_.-]+)\b/i);
    if (m?.[1]) {
      const val = normalizeToken(m[1]);
      if (val && !isWeakVersionCandidate(val)) return val;
    }
  }

  // D) Bottom-of-doc version token (e.g., TX_JE_NF_EFL_ENG_V1.5_SEP_01_25).
  const tail = lines.filter(Boolean).slice(-20);
  for (const l of tail) {
    if (
      l.includes("_") &&
      /[0-9]/.test(l) &&
      /^[A-Z0-9_.-]+$/i.test(l) &&
      l.length >= 8
    ) {
      const val = normalizeToken(l);
      if (val && !isWeakVersionCandidate(val)) return val;
    }
  }

  return null;
}

// Exported for tests and admin tooling.
export function extractEflVersionCodeFromText(text: string): string | null {
  return extractEflVersionCode(text);
}

// Exported for admin template persistence: best-effort label extraction from the EFL header/footer.
export function extractProviderAndPlanNameFromEflText(rawText: string): {
  providerName: string | null;
  planName: string | null;
} {
  const lines = (rawText || "")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  const header = lines.slice(0, 30);

  const isNoise = (l: string): boolean => {
    const s = l.toLowerCase();
    return (
      s.includes("electricity facts label") ||
      s === "electricity facts label" ||
      s.includes("(efl)") ||
      s.includes("service area") ||
      s.includes("delivery") ||
      s.includes("tdu") ||
      s.includes("tdsp") ||
      s.startsWith("date:") ||
      s.includes("average monthly use") ||
      s.includes("average price per") ||
      s.includes("puct certificate") ||
      s.startsWith("puct") ||
      s.startsWith("rep name:") ||
      s.startsWith("rep name") ||
      /^[0-9]{1,2}[-/][a-z]{3}[-/][0-9]{4}$/i.test(l) || // "08-Dec-2025"
      /^[a-z]+\s+\d{1,2},\s+\d{4}$/i.test(l) // "October 16, 2025"
    );
  };

  const headerCandidates = header.filter((l) => !isNoise(l));

  let providerName: string | null = headerCandidates[0] ?? null;
  let planName: string | null = headerCandidates[1] ?? null;

  // Footer fallback for provider: "dba <Brand>" (common in REP legal footer lines)
  if (!providerName) {
    const dbaLine = lines.find((l) => /dba\s+/i.test(l)) ?? null;
    if (dbaLine) {
      const m = dbaLine.match(/dba\s+(.+?)(?:,|$)/i);
      if (m?.[1]) providerName = m[1].trim();
    }
  }

  // Footer fallback for provider: "REP Name: <Brand>"
  if (!providerName) {
    const repLine = lines.find((l) => /^rep\s+name\s*:/i.test(l)) ?? null;
    if (repLine) {
      const m = repLine.match(/^rep\s+name\s*:\s*(.+)$/i);
      if (m?.[1]) providerName = m[1].trim();
    }
  }

  // Normalize overly-long provider strings (keep first clause)
  if (providerName) {
    providerName = providerName.split(" / ")[0]?.split(" • ")[0]?.trim() || providerName;
  }

  return {
    providerName: providerName && providerName.length >= 2 ? providerName : null,
    planName: planName && planName.length >= 2 ? planName : null,
  };
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
    if (!warnings.includes("Missing REP PUCT Certificate number.")) {
      warnings.push("Missing REP PUCT Certificate number.");
    }
  }

  const eflVersionCode = extractEflVersionCode(rawText);
  if (!eflVersionCode) {
    if (!warnings.includes("Missing EFL Ver. # version code.")) {
      warnings.push("Missing EFL Ver. # version code.");
    }
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