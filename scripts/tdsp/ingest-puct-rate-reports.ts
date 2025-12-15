import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";

import sourcesConfig from "@/lib/utility/tdspTariffSources.json";
import { upsertTdspTariffFromIngest } from "@/lib/utility/tdspIngest";
import { fetchPdfBytes } from "./_shared/fetchPdfBytes";
import { pdfBytesToText } from "./_shared/pdfToText";

type SourceEntry = {
  tdspCode: "ONCOR" | "CENTERPOINT" | "AEP_NORTH" | "AEP_CENTRAL" | "TNMP";
  kind: "PUCT_RATE_REPORT_PDF";
  sourceUrl: string | null;
  notes?: string;
};

type PuctDateCandidate = {
  iso: string;
  pos: number;
  source: string;
};

type PuctDateParse = {
  effectiveStartISO: string | null;
  candidates: PuctDateCandidate[];
  ambiguous: boolean;
  reason?: string;
};

const EMPTY_PUCT_DATE_PARSE: PuctDateParse = {
  effectiveStartISO: null,
  candidates: [],
  ambiguous: false,
  reason: "NO_DATES",
};

type IngestArgs = {
  debugDate: boolean;
};

function log(...args: any[]) {
  // eslint-disable-next-line no-console
  console.log("[tdsp-ingest]", ...args);
}

function sha256Hex(buf: Uint8Array): string {
  return createHash("sha256").update(buf).digest("hex");
}

function parsePuctEffectiveDateISO(text: string): PuctDateParse {
  // Normalize whitespace; keep a version with newlines and a flattened version.
  const norm = text.replace(/\r/g, "\n");
  const tight = norm.replace(/[ \t]+/g, " ");
  const flat = tight.replace(/\n+/g, "\n");

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

  type DateHit = { iso: string; index: number; source: string };
  const hits: DateHit[] = [];

  const lowerFlat = flat.toLowerCase();
  const headWindow = flat.slice(0, 800);

  function addNumeric(
    mm: string,
    dd: string,
    yyyy: string,
    index: number,
    source: string,
  ) {
    if (!/^\d{4}$/.test(yyyy)) return;
    const mmNum = String(parseInt(mm, 10)).padStart(2, "0");
    const ddNum = String(parseInt(dd, 10)).padStart(2, "0");
    const iso = `${yyyy}-${mmNum}-${ddNum}`;
    hits.push({ iso, index, source });
  }

  // A) "Rates Effective 09/01/2025"
  {
    const re =
      /rates\s+effective\s*[:\-]?\s*(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})/gi;
    let m: RegExpExecArray | null;
    // eslint-disable-next-line no-cond-assign
    while ((m = re.exec(flat)) !== null) {
      addNumeric(m[1], m[2], m[3], m.index, "RATES_EFFECTIVE");
    }
  }

  // A2) "Rates Report 09/01/2025" (some PUCT/CenterPoint layouts)
  {
    const re =
      /rates\s+report\s+(\d{1,2})[\/\-\.\s](\d{1,2})[\/\-\.\s](\d{4})/gi;
    let m: RegExpExecArray | null;
    // eslint-disable-next-line no-cond-assign
    while ((m = re.exec(headWindow)) !== null) {
      addNumeric(m[1], m[2], m[3], m.index, "RATES_REPORT");
    }
  }

  // A3) Generic numeric dates M/D/YYYY (anywhere in the document, capped).
  {
    const re =
      /(?:\b)(\d{1,2})[\/\-\.\s](\d{1,2})[\/\-\.\s](\d{4})(?:\b)/g;
    let m: RegExpExecArray | null;
    // eslint-disable-next-line no-cond-assign
    while ((m = re.exec(flat)) !== null) {
      addNumeric(m[1], m[2], m[3], m.index, "GENERIC_NUMERIC");
      if (hits.length >= 200) break;
    }
  }

  // B) "Effective Date 09/01/2025" or "Effective 09/01/2025"
  {
    const re =
      /effective\s*(?:date)?\s*[:\-]?\s*(\d{1,2})[\/\-\.\s](\d{1,2})[\/\-\.\s](\d{4})/gi;
    let m: RegExpExecArray | null;
    // eslint-disable-next-line no-cond-assign
    while ((m = re.exec(flat)) !== null) {
      addNumeric(m[1], m[2], m[3], m.index, "EFFECTIVE");
    }
  }

  // C) "As of 09/01/2025"
  {
    const re =
      /as\s+of\s*(\d{1,2})[\/\-\.\s](\d{1,2})[\/\-\.\s](\d{4})/gi;
    let m: RegExpExecArray | null;
    // eslint-disable-next-line no-cond-assign
    while ((m = re.exec(flat)) !== null) {
      addNumeric(m[1], m[2], m[3], m.index, "AS_OF");
    }
  }

  // D) Month-name style: "September 1, 2024"
  {
    const re =
      /\b(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{1,2}),\s*(\d{4})\b/gi;
    let m: RegExpExecArray | null;
    // eslint-disable-next-line no-cond-assign
    while ((m = re.exec(flat)) !== null) {
      const mm = monthMap[m[1].toLowerCase()];
      const dd = String(parseInt(m[2], 10)).padStart(2, "0");
      const yyyy = m[3];
      if (!mm) continue;
      const iso = `${yyyy}-${mm}-${dd}`;
      hits.push({ iso, index: m.index, source: "MONTH_NAME" });
    }
  }

  if (hits.length === 0) {
    return { ...EMPTY_PUCT_DATE_PARSE };
  }

  // Keyword-guided selection when multiple dates appear.
  const keywordRe =
    /(rates\s+effective|effective\s+date|effective|as\s+of|rates\s+report|puct\s+monthly\s+report)/gi;
  const keywordPositions: number[] = [];
  {
    let m: RegExpExecArray | null;
    // eslint-disable-next-line no-cond-assign
    while ((m = keywordRe.exec(lowerFlat)) !== null) {
      keywordPositions.push(m.index);
    }
  }

  const uniqueIso = Array.from(new Set(hits.map((h) => h.iso)));

    if (keywordPositions.length > 0) {
    let bestHit: DateHit | null = null;
    let bestDist = Number.POSITIVE_INFINITY;
    let bestCount = 0;

    for (const h of hits) {
      for (const k of keywordPositions) {
        const dist = Math.abs(h.index - k);
        if (dist < bestDist) {
          bestDist = dist;
          bestHit = h;
          bestCount = 1;
        } else if (dist === bestDist) {
          bestCount += 1;
        }
      }
    }

      if (bestHit && bestCount === 1) {
        return {
          effectiveStartISO: bestHit.iso,
          candidates: hits.map((h) => ({
            iso: h.iso,
            pos: h.index,
            source: h.source,
          })),
          ambiguous: false,
          reason: "ANCHOR_CHOSEN",
        };
      }

      return {
        effectiveStartISO: null,
        candidates: hits.map((h) => ({
          iso: h.iso,
          pos: h.index,
          source: h.source,
        })),
        ambiguous: true,
        reason: "AMBIGUOUS_ANCHOR",
      };
  }

  // No keywords: fall back to "single date in head window" heuristic.
  const headLimit = 1200;
  const headHits = hits.filter((h) => h.index < headLimit);

  if (headHits.length === 1) {
    return {
      effectiveStartISO: headHits[0]!.iso,
      candidates: hits.map((h) => ({
        iso: h.iso,
        pos: h.index,
        source: h.source,
      })),
      ambiguous: false,
      reason: "HEADER_SINGLE_DATE",
    };
  }

  if (headHits.length > 1) {
    return {
      effectiveStartISO: null,
      candidates: headHits.map((h) => ({
        iso: h.iso,
        pos: h.index,
        source: h.source,
      })),
      ambiguous: true,
      reason: "HEADER_MULTIPLE_DATES",
    };
  }

  // Dates exist but not in the head window and no keywords to anchor them.
  return {
    effectiveStartISO: null,
    candidates: hits.map((h) => ({
      iso: h.iso,
      pos: h.index,
      source: h.source,
    })),
    ambiguous: true,
    reason: "UNANCHORED_AMBIGUOUS",
  };
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

async function ingestForSource(entry: SourceEntry, args: IngestArgs) {
  const { tdspCode, sourceUrl } = entry;
  const { debugDate } = args;

  if (!sourceUrl) {
    log(tdspCode, "skip: sourceUrl is null (TODO fill PUCT Rate_Report URL).");
    return;
  }

  log(tdspCode, "fetching PDF from", sourceUrl);
  const pdfBytes = await fetchPdfBytes(sourceUrl);
  const sha = sha256Hex(pdfBytes);

  log(tdspCode, "pdf sha256", sha);

  // Persist raw PDF into /tmp for debugging if needed.
  const debugTmpPath = `/tmp/tdsp_${tdspCode}_Rate_Report.pdf`;
  try {
    await fs.writeFile(debugTmpPath, pdfBytes);
  } catch {
    // Best-effort debug write; ignore errors (e.g., non-Unix envs).
  }

  const { text, method, textLen } = await pdfBytesToText({
    pdfBytes,
    hintName: `${tdspCode}-puct-rate-report`,
  });
  log(tdspCode, "pdfToText", { method, textLen });
  if (textLen === 0) {
    log(
      tdspCode,
      "ERROR: pdfToText returned empty text; skipping before parsing.",
    );
    return;
  }

  const parsedRaw = parsePuctEffectiveDateISO(text);
  const parsedDate: PuctDateParse =
    (parsedRaw && typeof parsedRaw === "object"
      ? parsedRaw
      : EMPTY_PUCT_DATE_PARSE);
  const candidatesSafe = Array.isArray(parsedDate.candidates)
    ? parsedDate.candidates
    : [];

  const effectiveStartISO = parsedDate.effectiveStartISO;

  if (!effectiveStartISO) {
    if (debugDate) {
      const headPreview = text.replace(/\s+/g, " ").slice(0, 400);
      log(tdspCode, "debugDate headPreview", {
        headPreview,
        candidates: candidatesSafe.slice(0, 10),
        reason: parsedDate.reason,
        ambiguous: parsedDate.ambiguous,
      });
      log(tdspCode, "debugDate candidates", {
        effectiveStartISO: parsedDate.effectiveStartISO,
        ambiguous: parsedDate.ambiguous,
        reason: parsedDate.reason,
        candidates: candidatesSafe.slice(0, 10),
      });
    }

    if (candidatesSafe.length > 1 || parsedDate.ambiguous) {
      log(tdspCode, "skip: ambiguous effective dates found", {
        candidates: candidatesSafe,
      });
    } else {
      log(tdspCode, "skip: no effective date found in text.");
    }
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
  const argv = process.argv.slice(2);
  let debugDate = false;
  for (const arg of argv) {
    if (arg.startsWith("--debugDate=")) {
      const v = arg.slice("--debugDate=".length);
      debugDate = v === "1" || v.toLowerCase() === "true";
    }
  }

  const entries = (sourcesConfig as any).sources as Array<
    SourceEntry & { kind?: string }
  >;

  const rateReportEntries = entries.filter(
    (e) => e.kind === "PUCT_RATE_REPORT_PDF",
  );

  for (const entry of rateReportEntries) {
    try {
      await ingestForSource(entry, { debugDate });
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : String(err ?? "unknown error");
      log(entry.tdspCode, "error during ingest:", msg);
    }
  }
}

void main();


