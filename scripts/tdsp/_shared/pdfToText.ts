import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { Buffer } from "node:buffer";

import { deterministicEflExtract } from "@/lib/efl/eflExtractor";

const execFileAsync = promisify(execFile);

type PdfToTextMethod = "LOCAL_PDFTOTEXT" | "DROPLET_PDFTOTEXT";

function log(...args: any[]) {
  // eslint-disable-next-line no-console
  console.log("[tdsp-pdfToText]", ...args);
}

export async function hasLocalPdftotext(): Promise<boolean> {
  try {
    await execFileAsync("pdftotext", ["-v"]);
    return true;
  } catch {
    return false;
  }
}

export async function pdfBytesToText(args: {
  pdfBytes: Uint8Array;
  hintName: string;
}): Promise<{ text: string; method: PdfToTextMethod; textLen: number }> {
  const { pdfBytes, hintName } = args;

  const tmpDir = os.tmpdir();
  const safeHint = hintName.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 40);
  const stamp = Date.now().toString(36);
  const tmpPdf = path.join(tmpDir, `${safeHint || "tdsp"}.${stamp}.pdf`);
  const tmpTxt = path.join(tmpDir, `${safeHint || "tdsp"}.${stamp}.txt`);

  const buffer = Buffer.isBuffer(pdfBytes)
    ? (pdfBytes as Buffer)
    : Buffer.from(pdfBytes);

  // Try local Poppler pdftotext first.
  try {
    await fs.writeFile(tmpPdf, buffer);
    await execFileAsync("pdftotext", ["-layout", tmpPdf, tmpTxt]);

    const txtBuf = await fs.readFile(tmpTxt);
    const text = txtBuf.toString("utf8");
    const textLen = text.trim().length;

    await fs.unlink(tmpPdf).catch(() => {});
    await fs.unlink(tmpTxt).catch(() => {});

    log("used local pdftotext", { hintName, textLen });

    return { text, method: "LOCAL_PDFTOTEXT", textLen };
  } catch (err) {
    const msg =
      err instanceof Error ? err.message : String(err ?? "unknown error");
    log("local pdftotext failed; falling back to droplet", {
      hintName,
      error: msg,
    });
    // Best-effort cleanup before falling back.
    await fs.unlink(tmpPdf).catch(() => {});
    await fs.unlink(tmpTxt).catch(() => {});
  }

  // Fallback: use existing droplet-based deterministicEflExtract helper.
  const { rawText } = await deterministicEflExtract(buffer);
  const text = rawText ?? "";
  const textLen = text.trim().length;

  log("used droplet pdftotext", { hintName, textLen });

  return { text, method: "DROPLET_PDFTOTEXT", textLen };
}


