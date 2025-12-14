import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

import sourcesConfig from "@/lib/utility/tdspTariffSources.json";
import { extractPdfTextWithPdftotextOnly } from "@/lib/efl/eflExtractor";
import { upsertTdspTariffFromIngest } from "@/lib/utility/tdspIngest";

const execFileAsync = promisify(execFile);

type SourceEntry = {
  tdspCode: "ONCOR" | "CENTERPOINT" | "AEP_NORTH" | "AEP_CENTRAL" | "TNMP";
  kind: "PUCT_RATE_REPORT_PDF";
  sourceUrl: string | null;
  notes?: string;
};

function log(...args: any[]) {
  // eslint-disable-next-line no-console
  console.log("[tdsp-ingest]", ...args);
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
  const tmpPath = path.join(tmpDir, `tdsp_rate_report_${Date.now()}.pdf`);

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

function parseEffectiveDate(text: string): string | null {
  // Expect a phrase like: "As of December 1, 2025"
  const m = text.match(
    /As of\s+(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{1,2}),\s+(\d{4})/i,
  );
  if (!m) return null;
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
  const mm = monthMap[m[1].toLowerCase()];
  const dd = String(parseInt(m[2], 10)).padStart(2, "0");
  const yyyy = m[3];
  return `${yyyy}-${mm}-${dd}`;
}

function parseDollarsFromLine(line: string): number | null {
  const m = line.replace(/,/g, "").match(/\$?\s*([0-9]+(?:\.[0-9]+)?)/);
  if (!m?.[1]) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) ? n : null;
}

function parseAepRates(
  text: string,
): {
  north: { customerDollars: number; meteringDollars: number; volumetricDollarsPerKwh: number } | null;
  central: { customerDollars: number; meteringDollars: number; volumetricDollarsPerKwh: number } | null;
} {
  // Skeleton: look for lines that contain "Customer Charge" / "Metering Charge" / "Volumetric Charge"
  // and assume the format "Label ... Central ... North".
  const lines = text.split(/\r?\n/).map((l) => l.trim());

  const findRow = (label: string) =>
    lines.find((l) => l.toLowerCase().includes(label.toLowerCase()));

  const customerLine = findRow("Customer Charge");
  const meteringLine = findRow("Metering Charge");
  const volumetricLine = findRow("Volumetric Charge");

  if (!customerLine || !meteringLine || !volumetricLine) {
    return { north: null, central: null };
  }

  // Very simple split: assume "... Central <dollars> North <dollars>" ordering.
  function splitTwoNumbers(line: string): { central: number | null; north: number | null } {
    const nums = line
      .replace(/,/g, "")
      .match(/([0-9]+(?:\.[0-9]+)?)/g);
    if (!nums || nums.length < 2) return { central: null, north: null };
    const central = Number(nums[0]);
    const north = Number(nums[1]);
    return {
      central: Number.isFinite(central) ? central : null,
      north: Number.isFinite(north) ? north : null,
    };
  }

  const cust = splitTwoNumbers(customerLine);
  const meter = splitTwoNumbers(meteringLine);
  const vol = splitTwoNumbers(volumetricLine);

  const north =
    cust.north != null && meter.north != null && vol.north != null
      ? {
          customerDollars: cust.north,
          meteringDollars: meter.north,
          volumetricDollarsPerKwh: vol.north,
        }
      : null;

  const central =
    cust.central != null && meter.central != null && vol.central != null
      ? {
          customerDollars: cust.central,
          meteringDollars: meter.central,
          volumetricDollarsPerKwh: vol.central,
        }
      : null;

  return { north, central };
}

function parseSingleUtilityRates(text: string): {
  customerDollars: number;
  meteringDollars: number;
  volumetricDollarsPerKwh: number;
} | null {
  const lines = text.split(/\r?\n/).map((l) => l.trim());

  const customerLine = lines.find((l) =>
    l.toLowerCase().includes("customer charge"),
  );
  const meteringLine = lines.find((l) =>
    l.toLowerCase().includes("metering charge"),
  );
  const volumetricLine = lines.find((l) =>
    l.toLowerCase().includes("volumetric charge"),
  );

  if (!customerLine || !meteringLine || !volumetricLine) {
    return null;
  }

  const customerDollars = parseDollarsFromLine(customerLine);
  const meteringDollars = parseDollarsFromLine(meteringLine);
  const volumetricDollarsPerKwh = parseDollarsFromLine(volumetricLine);

  if (
    customerDollars == null ||
    meteringDollars == null ||
    volumetricDollarsPerKwh == null
  ) {
    return null;
  }

  return {
    customerDollars,
    meteringDollars,
    volumetricDollarsPerKwh,
  };
}

async function ingestForSource(entry: SourceEntry) {
  const { tdspCode, sourceUrl } = entry;

  if (!sourceUrl) {
    log(tdspCode, "skip: sourceUrl is null (TODO fill PUCT Rate_Report URL).");
    return;
  }

  log(tdspCode, "fetching PDF from", sourceUrl);
  const pdfBytes = await fetchPdfBytes(sourceUrl);
  const sha = sha256Hex(pdfBytes);

  log(tdspCode, "pdf sha256", sha);

  // Persist raw PDF into /tmp for debugging if needed.
  const tmpPath = `/tmp/tdsp_${tdspCode}_Rate_Report.pdf`;
  await fs.writeFile(tmpPath, pdfBytes);

  const text = await extractPdfTextWithPdftotextOnly(Buffer.from(pdfBytes));

  const effectiveStartISO = parseEffectiveDate(text);
  if (!effectiveStartISO) {
    log(tdspCode, "skip: could not parse effective date from text.");
    return;
  }

  if (tdspCode === "AEP_NORTH" || tdspCode === "AEP_CENTRAL") {
    const parsed = parseAepRates(text);
    const row =
      tdspCode === "AEP_NORTH" ? parsed.north : parsed.central;
    if (!row) {
      log(tdspCode, "skip: could not parse North/Central columns from AEP report.");
      return;
    }

    const monthlyCents = Math.round(
      (row.customerDollars + row.meteringDollars) * 100,
    ).toString();
    const perKwhCents = (row.volumetricDollarsPerKwh * 100).toString();

    const res = await upsertTdspTariffFromIngest({
      tdspCode,
      effectiveStartISO,
      sourceUrl,
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

    log(tdspCode, "ingest result", res);
    return;
  }

  const single = parseSingleUtilityRates(text);
  if (!single) {
    log(tdspCode, "skip: could not parse single-utility rates from report.");
    return;
  }

  const monthlyCents = Math.round(
    (single.customerDollars + single.meteringDollars) * 100,
  ).toString();
  const perKwhCents = (single.volumetricDollarsPerKwh * 100).toString();

  const res = await upsertTdspTariffFromIngest({
    tdspCode,
    effectiveStartISO,
    sourceUrl,
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

  log(tdspCode, "ingest result", res);
}

async function main() {
  const entries = (sourcesConfig as any).sources as SourceEntry[];

  for (const entry of entries) {
    try {
      await ingestForSource(entry);
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : String(err ?? "unknown error");
      log(entry.tdspCode, "error during ingest:", msg);
    }
  }
}

void main();


