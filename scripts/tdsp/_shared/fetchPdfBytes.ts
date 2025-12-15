import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

function log(...args: any[]) {
  // eslint-disable-next-line no-console
  console.log("[tdsp-fetch]", ...args);
}

/**
 * Fetch PDF bytes from a URL with a TLS-safe fallback strategy:
 * - Try Node fetch() first.
 * - On any failure (including TLS chain issues), fall back to:
 *   - Windows: PowerShell Invoke-WebRequest (OS trust store).
 *   - Non-Windows: curl -L.
 */
export async function fetchPdfBytes(url: string): Promise<Uint8Array> {
  // Primary path: Node fetch (works well on Linux, often fine on macOS/Windows).
  try {
    const res = await fetch(url);
    if (!res.ok) {
      throw new Error(`HTTP ${res.status} ${res.statusText}`);
    }
    const arrayBuf = await res.arrayBuffer();
    return new Uint8Array(arrayBuf);
  } catch (err) {
    const msg =
      err instanceof Error ? err.message : String(err ?? "unknown error");
    log("primary fetch failed, considering fallback:", msg);
  }

  const isWindows = os.platform() === "win32";
  const tmpDir = os.tmpdir();
  const tmpPath = path.join(tmpDir, `tdsp_pdf_${Date.now()}.pdf`);

  if (isWindows) {
    // Windows: fall back to PowerShell Invoke-WebRequest, which uses the OS trust store.
    try {
      log("using PowerShell Invoke-WebRequest fallback for", url);
      await execFileAsync("powershell", [
        "-NoProfile",
        "-Command",
        `Invoke-WebRequest -Uri '${url}' -OutFile '${tmpPath}'`,
      ]);
      const buf = await fs.readFile(tmpPath);
      await fs.unlink(tmpPath).catch(() => {});
      return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : String(err ?? "unknown error");
      log("PowerShell Invoke-WebRequest fallback failed:", msg);
      throw err;
    }
  }

  // Non-Windows: try curl -L if available.
  try {
    log("using curl -L fallback for", url);
    await execFileAsync("curl", ["-L", "-o", tmpPath, url]);
    const buf = await fs.readFile(tmpPath);
    await fs.unlink(tmpPath).catch(() => {});
    return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
  } catch (err) {
    const msg =
      err instanceof Error ? err.message : String(err ?? "unknown error");
    log("curl fallback failed:", msg);
    throw err;
  }
}


