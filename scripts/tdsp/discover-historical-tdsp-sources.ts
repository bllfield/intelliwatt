import fs from "node:fs/promises";
import path from "node:path";

import sourcesConfig from "@/lib/utility/tdspTariffSources.json";

type TdspCode = "ONCOR" | "CENTERPOINT" | "AEP_NORTH" | "AEP_CENTRAL" | "TNMP";

type SourceKind =
  | "PUCT_RATE_REPORT_PDF"
  | "HISTORICAL_ARCHIVE_INDEX"
  | "TARIFF_HUB";

type SourceEntry = {
  tdspCode: TdspCode;
  kind: SourceKind;
  sourceUrl: string | null;
  notes?: string;
};

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
  console.log("[tdsp-historical]", ...args);
}

function guessTypeFromUrl(url: string): CandidateType | null {
  const lower = url.toLowerCase();
  if (lower.match(/\.(pdf)(?:[?#].*)?$/)) return "pdf";
  if (lower.match(/\.(docx?|rtf)(?:[?#].*)?$/)) return "doc";
  if (lower.match(/\.(xlsx?|csv)(?:[?#].*)?$/)) return "xls";
  if (lower.match(/\.(html?|aspx)(?:[?#].*)?$/)) return "html";
  return null;
}

function stripTags(html: string): string {
  return html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

async function fetchHtml(url: string): Promise<string> {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} ${res.statusText}`);
  }
  return await res.text();
}

async function discoverForSource(
  entry: SourceEntry,
): Promise<HistoricalCatalogEntry | null> {
  const { tdspCode, kind, sourceUrl } = entry;

  if (!sourceUrl) {
    log(tdspCode, "skip: sourceUrl is null for discovery kind", kind);
    return null;
  }

  if (kind !== "HISTORICAL_ARCHIVE_INDEX" && kind !== "TARIFF_HUB") {
    return null;
  }

  log(tdspCode, "fetching historical index:", sourceUrl);

  let html: string;
  try {
    html = await fetchHtml(sourceUrl);
  } catch (err) {
    const msg =
      err instanceof Error ? err.message : String(err ?? "unknown error");
    log(tdspCode, "error fetching index:", msg);
    return {
      tdspCode,
      sourceKind: kind,
      indexUrl: sourceUrl,
      candidates: [],
    };
  }

  const baseUrl = new URL(sourceUrl);

  // Very simple anchor parser: href + inner text.
  const hrefRegex = /<a[^>]+href=["']([^"']+)["'][^>]*>(.*?)<\/a>/gis;

  const byUrl = new Map<string, HistoricalCandidate>();

  let match: RegExpExecArray | null;
  // eslint-disable-next-line no-cond-assign
  while ((match = hrefRegex.exec(html)) !== null) {
    const hrefRaw = match[1]?.trim();
    if (!hrefRaw) continue;

    const innerHtml = match[2] ?? "";
    const label = stripTags(innerHtml);

    let absUrl: string;
    try {
      absUrl = new URL(hrefRaw, baseUrl).toString();
    } catch {
      continue;
    }

    const ctype = guessTypeFromUrl(absUrl);
    if (!ctype) continue;

    if (byUrl.has(absUrl)) continue;

    const labelHint =
      label && label.length > 0
        ? label
        : path.basename(new URL(absUrl).pathname) || null;

    byUrl.set(absUrl, {
      url: absUrl,
      type: ctype,
      labelHint,
      foundOn: sourceUrl,
    });
  }

  const candidates = Array.from(byUrl.values());
  log(tdspCode, "discovered", candidates.length, "historical candidates");

  return {
    tdspCode,
    sourceKind: kind,
    indexUrl: sourceUrl,
    candidates,
  };
}

async function main() {
  const entries = (sourcesConfig as any).sources as SourceEntry[];

  const discoveryTargets = entries.filter((e) =>
    ["HISTORICAL_ARCHIVE_INDEX", "TARIFF_HUB"].includes(e.kind),
  );

  const catalog: HistoricalCatalog = {
    generatedAt: new Date().toISOString(),
    entries: [],
  };

  for (const entry of discoveryTargets) {
    const result = await discoverForSource(entry);
    if (result) {
      catalog.entries.push(result);
    }
  }

  const outDir = path.join("scripts", "tdsp", "_outputs");
  const outPath = path.join(outDir, "tdsp-historical-catalog.json");

  await fs.mkdir(outDir, { recursive: true });
  await fs.writeFile(outPath, JSON.stringify(catalog, null, 2), "utf8");

  log("wrote catalog:", outPath, "entries:", catalog.entries.length);
}

void main();


