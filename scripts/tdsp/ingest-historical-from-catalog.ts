import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { deterministicEflExtract } from "@/lib/efl/eflExtractor";
import { upsertTdspTariffFromIngest } from "@/lib/utility/tdspIngest";
import { pdfBytesToText } from "./_shared/pdfToText";

const execFileAsync = promisify(execFile);

type TdspCode = "ONCOR" | "CENTERPOINT" | "AEP_NORTH" | "AEP_CENTRAL" | "TNMP";

type CandidateType = "pdf" | "html" | "doc" | "xls";

type HistoricalCandidate = {
  url: string;
  type: CandidateType;
  labelHint: string | null;
  foundOn: string;
};

type HistoricalCatalogEntry = {
  tdspCode: TdspCode;
  sourceKind: "HISTORICAL_ARCHIVE_INDEX" | "TARIFF_HUB";
  indexUrl: string;
  candidates: HistoricalCandidate[];
};

type HistoricalCatalog = {
  generatedAt: string;
  entries: HistoricalCatalogEntry[];
};

function log(...args: any[]) {
  // eslint-disable-next-line no-console
  console.log("[tdsp-historical-ingest]", ...args);
}

function sha256Hex(buf: Uint8Array): string {
  return createHash("sha256").update(buf).digest("hex");
}

async function fetchPdfBytes(url: string): Promise<Uint8Array> {
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
    log("fetchPdfBytes: primary fetch failed, considering fallback:", msg);
  }

  const isWindows = os.platform() === "win32";
  const tmpDir = os.tmpdir();
  const tmpPath = path.join(tmpDir, `tdsp_hist_${Date.now()}.pdf`);

  if (isWindows) {
    // Windows: fall back to PowerShell Invoke-WebRequest, which uses the OS trust store.
    try {
      log(
        "fetchPdfBytes: using PowerShell Invoke-WebRequest fallback for",
        url,
      );
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
      log(
        "fetchPdfBytes: PowerShell Invoke-WebRequest fallback failed:",
        msg,
      );
      throw err;
    }
  }

  // Non-Windows: try curl -L if available.
  try {
    log("fetchPdfBytes: using curl -L fallback for", url);
    await execFileAsync("curl", ["-L", "-o", tmpPath, url]);
    const buf = await fs.readFile(tmpPath);
    await fs.unlink(tmpPath).catch(() => {});
    return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
  } catch (err) {
    const msg =
      err instanceof Error ? err.message : String(err ?? "unknown error");
    log("fetchPdfBytes: curl fallback failed:", msg);
    throw err;
  }
}

function parseArgs(): {
  tdsp: TdspCode;
  limit: number;
  debugEffective: boolean;
  debugHead: boolean;
  probe: boolean;
} {
  const argv = process.argv.slice(2);
  let tdsp: TdspCode | null = null;
  let limit = 20;
  let debugEffective = false;
  let debugHead = false;
  let probe = false;

  for (const arg of argv) {
    if (arg.startsWith("--tdsp=")) {
      const v = arg.slice("--tdsp=".length) as TdspCode;
      tdsp = v;
    } else if (arg.startsWith("--limit=")) {
      const raw = Number(arg.slice("--limit=".length));
      if (Number.isFinite(raw) && raw > 0) {
        limit = Math.floor(raw);
      }
    } else if (arg.startsWith("--debugEffective=")) {
      const v = arg.slice("--debugEffective=".length);
      debugEffective = v === "1" || v.toLowerCase() === "true";
    } else if (arg.startsWith("--debugHead=")) {
      const v = arg.slice("--debugHead=".length);
      debugHead = v === "1" || v.toLowerCase() === "true";
    } else if (arg.startsWith("--probe=")) {
      const v = arg.slice("--probe=".length);
      probe = v === "1" || v.toLowerCase() === "true";
    }
  }

  const allowed: TdspCode[] = [
    "ONCOR",
    "CENTERPOINT",
    "AEP_NORTH",
    "AEP_CENTRAL",
    "TNMP",
  ];

  if (!tdsp || !allowed.includes(tdsp)) {
    throw new Error(
      `--tdsp must be one of ${allowed.join(
        ", ",
      )}. Example: --tdsp=CENTERPOINT --limit=20 --debugEffective=1 --debugHead=1 --probe=1`,
    );
  }

  return { tdsp, limit, debugEffective, debugHead, probe };
}

function parseEffectiveDateISO(text: string): string | null {
  // Normalize whitespace + newlines so we can tolerate "Effective\nDate" etc.
  const norm = text.replace(/\r/g, "\n");
  const tight = norm.replace(/[ \t]+/g, " ");
  const squish = tight.replace(/\n+/g, "\n");

  const monthMap: Record<string, string> = {
    january: "01",
    february: "02",
    march: "03",
    april: "04",
    may: "05",
    june: "06",
    july: "07",
    august: "08",
    september: "09",
    october: "10",
    november: "11",
    december: "12",
  };

  // A) "Effective Date: MM/DD/YYYY" (allow spaces, -, ., / as separators).
  const mNum = squish.match(
    /effective\s*date\s*[:\-]?\s*(\d{1,2}[\/\-\.\s]\d{1,2}[\/\-\.\s]\d{2,4})/i,
  );
  if (mNum?.[1]) {
    const rawDate = mNum[1].replace(/[.\-\s]/g, "/");
    const parts = rawDate.split("/");
    if (parts.length === 3) {
      const mm = String(parseInt(parts[0], 10)).padStart(2, "0");
      const dd = String(parseInt(parts[1], 10)).padStart(2, "0");
      const yyyy = parts[2];
      // For now, only accept 4-digit years to avoid guessing.
      if (/^\d{4}$/.test(yyyy)) {
        return `${yyyy}-${mm}-${dd}`;
      }
    }
  }

  // B) "Effective: Month DD, YYYY"
  const mEff = squish.match(
    /effective\s*[:\-]?\s*(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{1,2}),\s*(\d{4})/i,
  );
  if (mEff) {
    const mm = monthMap[mEff[1].toLowerCase()];
    const dd = String(parseInt(mEff[2], 10)).padStart(2, "0");
    const yyyy = mEff[3];
    if (mm) return `${yyyy}-${mm}-${dd}`;
  }

  // C) "As of Month DD, YYYY"
  const mAsOf = squish.match(
    /as\s*of\s*(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{1,2}),\s*(\d{4})/i,
  );
  if (mAsOf) {
    const mm = monthMap[mAsOf[1].toLowerCase()];
    const dd = String(parseInt(mAsOf[2], 10)).padStart(2, "0");
    const yyyy = mAsOf[3];
    if (mm) return `${yyyy}-${mm}-${dd}`;
  }

  return null;
}

function parseHeaderDateISO(text: string): string | null {
  const norm = text.replace(/\r/g, "\n");
  const tight = norm.replace(/[ \t]+/g, " ");
  const squish = tight.replace(/\n+/g, " ");
  const head = squish.slice(0, 2500);

  const monthMap: Record<string, string> = {
    january: "01",
    february: "02",
    march: "03",
    april: "04",
    may: "05",
    june: "06",
    july: "07",
    august: "08",
    september: "09",
    october: "10",
    november: "11",
    december: "12",
  };

  const matches: string[] = [];

  // Month-name dates: "September 1, 2024"
  const monthRe =
    /\b(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{1,2}),\s*(\d{4})\b/gi;
  let m: RegExpExecArray | null;
  // eslint-disable-next-line no-cond-assign
  while ((m = monthRe.exec(head)) !== null) {
    const mm = monthMap[m[1].toLowerCase()];
    const dd = String(parseInt(m[2], 10)).padStart(2, "0");
    const yyyy = m[3];
    if (mm) {
      matches.push(`${yyyy}-${mm}-${dd}`);
    }
  }

  // Numeric dates: "09/01/2024" or "9-1-2024"
  const numRe =
    /\b(\d{1,2})[\/\-\.\s](\d{1,2})[\/\-\.\s](\d{4})\b/g;
  // eslint-disable-next-line no-cond-assign
  while ((m = numRe.exec(head)) !== null) {
    const mm = String(parseInt(m[1], 10)).padStart(2, "0");
    const dd = String(parseInt(m[2], 10)).padStart(2, "0");
    const yyyy = m[3];
    if (/^\d{4}$/.test(yyyy)) {
      matches.push(`${yyyy}-${mm}-${dd}`);
    }
  }

  if (matches.length === 1) {
    return matches[0]!;
  }

  return null;
}

function logEffectiveDebugSnippet(text: string, url: string) {
  const norm = text.replace(/\r/g, "\n");
  const lower = norm.toLowerCase();
  const idx = lower.indexOf("effective");
  if (idx === -1) {
    log("debugEffective: 'effective' not found in text for url", url);
    return;
  }
  const start = Math.max(0, idx - 400);
  const end = Math.min(norm.length, idx + 400);
  const snippet = norm.slice(start, end);
  log("debugEffective snippet", {
    url,
    snippet,
  });
}

function parseDollarsFromLine(line: string): number | null {
  const m = line.replace(/,/g, "").match(/\$?\s*([0-9]+(?:\.[0-9]+)?)/);
  if (!m?.[1]) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) ? n : null;
}

function parseVolumetricRateDollarsPerKwh(line: string): number | null {
  // Accept very small decimals like 0.0009 etc.
  const m = line.replace(/,/g, "").match(/\$?\s*([0-9]+(?:\.[0-9]+)?)/);
  if (!m?.[1]) return null;
  const n = Number(m[1]);
  if (!Number.isFinite(n)) return null;
  // Sanity: expect something like 0 < n < 1 dollars per kWh (0–100¢)
  if (n <= 0 || n > 1) return null;
  return n;
}

function parseCharges(text: string): {
  monthlyCents: string;
  perKwhCents: string;
} | null {
  const lines = text.split(/\r?\n/).map((l) => l.trim());

  const findLine = (needle: string) =>
    lines.find((l) => l.toLowerCase().includes(needle.toLowerCase()));

  const customerLine = findLine("Customer Charge");
  const meteringLine = findLine("Metering Charge");

  const volumetricLine =
    findLine("Volumetric Charge") ||
    findLine("Delivery Charge") ||
    lines.find((l) =>
      l.toLowerCase().includes("per kwh"),
    );

  if (!customerLine || !volumetricLine) {
    return null;
  }

  const customerDollars = parseDollarsFromLine(customerLine);
  const meteringDollars = meteringLine
    ? parseDollarsFromLine(meteringLine)
    : 0;
  const volumetricDollarsPerKwh =
    parseVolumetricRateDollarsPerKwh(volumetricLine);

  if (
    customerDollars == null ||
    volumetricDollarsPerKwh == null ||
    meteringDollars == null
  ) {
    return null;
  }

  const monthlyCents = Math.round(
    (customerDollars + meteringDollars) * 100,
  ).toString();
  const perKwhCents = (volumetricDollarsPerKwh * 100).toString();

  return { monthlyCents, perKwhCents };
}

async function main() {
  const { tdsp, limit, debugEffective, debugHead, probe } = parseArgs();
  log(
    "starting historical ingest for",
    tdsp,
    "limit",
    limit,
    "debugEffective",
    debugEffective,
    "debugHead",
    debugHead,
    "probe",
    probe,
  );

  const catalogPath = path.join(
    "scripts",
    "tdsp",
    "_outputs",
    "tdsp-historical-catalog.json",
  );
  const raw = await fs.readFile(catalogPath, "utf8");
  const catalog = JSON.parse(raw) as HistoricalCatalog;

  const entry = catalog.entries.find((e) => e.tdspCode === tdsp);
  if (!entry) {
    throw new Error(`No historical catalog entry found for tdspCode=${tdsp}`);
  }

  const pdfCandidates = entry.candidates.filter(
    (c) => c.type === "pdf" && c.url.toLowerCase().includes(".pdf"),
  );

  log(
    "total pdf candidates for",
    tdsp,
    ":",
    pdfCandidates.length,
    "(processing up to",
    limit,
    ")",
  );

  if (probe) {
    const probeStats: Array<{
      url: string;
      method: "LOCAL_PDFTOTEXT" | "DROPLET_PDFTOTEXT";
      textLen: number;
      hasDigits: boolean;
      hasKwh: boolean;
      hasCustomer: boolean;
      hasVolumetric: boolean;
    }> = [];

    let processedProbe = 0;

    for (const candidate of pdfCandidates.slice(0, limit)) {
      processedProbe += 1;
      const url = candidate.url;
      log("probe candidate", processedProbe, "url:", url);

      try {
        const pdfBytes = await fetchPdfBytes(url);
        const { text, method } = await pdfBytesToText({
          pdfBytes,
          hintName: `${tdsp}-historical-${processedProbe}`,
        });

        const trimmed = text.trim();
        const textLen = trimmed.length;
        const hasDigits = /\d/.test(trimmed);
        const hasKwh = /kwh/i.test(trimmed);
        const hasCustomer = /customer/i.test(trimmed);
        const hasVolumetric = /(volumetric|delivery)/i.test(trimmed);

        const stats = {
          url,
          method,
          textLen,
          hasDigits,
          hasKwh,
          hasCustomer,
          hasVolumetric,
        };

        probeStats.push(stats);

        log("probe summary", stats);
      } catch (err) {
        const msg =
          err instanceof Error ? err.message : String(err ?? "unknown error");
        log("probe error", { url, error: msg });
      }
    }

    const ranked = [...probeStats].sort((a, b) => b.textLen - a.textLen);
    log(
      "probe top10 by textLen",
      ranked.slice(0, 10).map((s) => ({
        url: s.url,
        method: s.method,
        textLen: s.textLen,
        hasDigits: s.hasDigits,
        hasKwh: s.hasKwh,
        hasCustomer: s.hasCustomer,
        hasVolumetric: s.hasVolumetric,
      })),
    );

    return;
  }

  let processed = 0;
  let created = 0;
  let noop = 0;
  let skipped = 0;

  for (const candidate of pdfCandidates.slice(0, limit)) {
    processed += 1;
    const url = candidate.url;
    log("candidate", processed, "url:", url);

    try {
      const pdfBytes = await fetchPdfBytes(url);
      const sha = sha256Hex(pdfBytes);

      const { rawText } = await deterministicEflExtract(
        Buffer.from(pdfBytes),
      );

      if (debugHead && processed === 1) {
        const headPreview = rawText.replace(/\s+/g, " ").slice(0, 600);
        log("debugHead headPreview", { url, headPreview });
      }

      let effectiveStartISO = parseEffectiveDateISO(rawText);
      let effectiveDateSource: "PATTERN" | "HEADER_DATE" | null = null;
      if (effectiveStartISO) {
        effectiveDateSource = "PATTERN";
      } else {
        const headerDate = parseHeaderDateISO(rawText);
        if (headerDate) {
          effectiveStartISO = headerDate;
          effectiveDateSource = "HEADER_DATE";
        }
      }

      if (!effectiveStartISO) {
        if (debugEffective) {
          logEffectiveDebugSnippet(rawText, url);
        }
        skipped += 1;
        log("skip (no effective date found)", { url });
        continue;
      }

      const charges = parseCharges(rawText);
      if (!charges) {
        skipped += 1;
        log("skip (could not parse charges)", { url, effectiveStartISO });
        continue;
      }

      const { monthlyCents, perKwhCents } = charges;

      log(
        "parsed",
        {
          url,
          effectiveStartISO,
          monthlyCents,
          perKwhCents,
          effectiveDateSource,
        },
      );

      const res = await upsertTdspTariffFromIngest({
        tdspCode: tdsp,
        effectiveStartISO,
        sourceUrl: url,
        sourceDocSha256: sha,
        components: [
          {
            chargeName: "Customer + Metering Charge",
            chargeType: "CUSTOMER",
            unit: "PER_MONTH",
            rateCents: monthlyCents,
          },
          {
            chargeName: "Volumetric Delivery Charge",
            chargeType: "DELIVERY",
            unit: "PER_KWH",
            rateCents: perKwhCents,
          },
        ],
      });

      if (res.action === "created") {
        created += 1;
        log("action=created", { versionId: res.versionId });
      } else {
        noop += 1;
        log("action=no-op (existing version matches sha)", {
          versionId: res.versionId,
        });
      }
    } catch (err) {
      skipped += 1;
      const msg =
        err instanceof Error ? err.message : String(err ?? "unknown error");
      log("skip (error during ingest)", { url, error: msg });
    }
  }

  log("summary", { tdsp, processed, created, noop, skipped });
}

void main();


