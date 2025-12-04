import { XMLParser } from "fast-xml-parser";
import { GreenButtonRawReading } from "./greenButtonNormalize";

export type ParsedGreenButtonResult = {
  /** Detected source format */
  format: "xml" | "csv" | "json" | "unknown";
  /** Raw readings extracted from the file */
  readings: GreenButtonRawReading[];
  /** Metadata extracted from the file (best-effort) */
  metadata: {
    timezoneOffsetSeconds: number | null;
    meterSerialNumber: string | null;
    sourceTitle: string | null;
    totalReadings: number;
  };
  /** Non-fatal parsing warnings */
  warnings: string[];
  /** Fatal errors encountered while parsing */
  errors: string[];
};

const XML_PARSER_OPTIONS = {
  ignoreAttributes: false,
  removeNSPrefix: true,
  parseTagValue: false,
  parseAttributeValue: false,
  trimValues: true,
};

/**
 * Parse a Green Button file (XML/CSV/JSON) into raw readings that can later be normalized.
 * The parser is intentionally tolerant and will return as many readings as it can recover.
 */
export function parseGreenButtonBuffer(buffer: Buffer, filename?: string | null): ParsedGreenButtonResult {
  const warnings: string[] = [];
  const errors: string[] = [];

  const content = stripBom(buffer.toString("utf8"));
  const trimmed = content.trim();
  const extension = filename?.toLowerCase().split(".").pop() ?? "";

  let format: ParsedGreenButtonResult["format"] = "unknown";
  if (extension === "xml" || trimmed.startsWith("<")) {
    format = "xml";
  } else if (extension === "csv" || trimmed.includes(",") || trimmed.includes("\n")) {
    format = "csv";
  } else if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    format = "json";
  }

  let readings: GreenButtonRawReading[] = [];
  let metadata = {
    timezoneOffsetSeconds: null as number | null,
    meterSerialNumber: null as string | null,
    sourceTitle: null as string | null,
    totalReadings: 0,
  };

  try {
    if (format === "xml") {
      const xmlResult = parseGreenButtonXml(content);
      readings = xmlResult.readings;
      metadata = {
        timezoneOffsetSeconds: xmlResult.timezoneOffsetSeconds,
        meterSerialNumber: xmlResult.meterSerialNumber,
        sourceTitle: xmlResult.sourceTitle,
        totalReadings: readings.length,
      };
      warnings.push(...xmlResult.warnings);
    } else if (format === "csv" || format === "unknown") {
      readings = parseGreenButtonCsv(content, warnings);
      metadata = {
        timezoneOffsetSeconds: null,
        meterSerialNumber: null,
        sourceTitle: filename ?? null,
        totalReadings: readings.length,
      };
    } else if (format === "json") {
      readings = parseGreenButtonJson(content, warnings);
      metadata = {
        timezoneOffsetSeconds: null,
        meterSerialNumber: null,
        sourceTitle: filename ?? null,
        totalReadings: readings.length,
      };
    }
  } catch (error) {
    errors.push(`Failed to parse file: ${(error as Error)?.message ?? error}`);
  }

  if (readings.length === 0) {
    warnings.push("No Green Button intervals were detected in the uploaded file.");
  }

  return {
    format,
    readings,
    metadata,
    warnings,
    errors,
  };
}

function stripBom(input: string): string {
  if (input.charCodeAt(0) === 0xfeff) {
    return input.slice(1);
  }
  return input;
}

type XmlParseResult = {
  readings: GreenButtonRawReading[];
  timezoneOffsetSeconds: number | null;
  meterSerialNumber: string | null;
  sourceTitle: string | null;
  warnings: string[];
};

function parseGreenButtonXml(xml: string): XmlParseResult {
  const parser = new XMLParser(XML_PARSER_OPTIONS);
  const warnings: string[] = [];
  let root: any;

  try {
    root = parser.parse(xml);
  } catch (error) {
    throw new Error(`XML parse error: ${(error as Error)?.message ?? error}`);
  }

  const readings: GreenButtonRawReading[] = [];
  collectXmlReadings(root, readings);

  if (readings.length === 0) {
    warnings.push("Parsed XML successfully, but no interval readings were found.");
  }

  const timezoneOffsetSeconds = parseIntOrNull(findFirstScalar(root, "tzOffset"));
  const meterSerialNumber = findFirstScalar(root, "meterSerialNumber");
  const sourceTitle = findFirstScalar(root, "title");

  return {
    readings,
    timezoneOffsetSeconds,
    meterSerialNumber,
    sourceTitle,
    warnings,
  };
}

function collectXmlReadings(node: unknown, out: GreenButtonRawReading[]) {
  if (!node) return;
  if (Array.isArray(node)) {
    for (const entry of node) {
      collectXmlReadings(entry, out);
    }
    return;
  }

  if (typeof node !== "object") {
    return;
  }

  const reading = readingFromNode(node as Record<string, unknown>);
  if (reading) {
    out.push(reading);
  }

  for (const value of Object.values(node as Record<string, unknown>)) {
    collectXmlReadings(value, out);
  }
}

function readingFromNode(node: Record<string, unknown>): GreenButtonRawReading | null {
  const start = getScalar(node.start);
  const duration = parseIntOrNull(getScalar(node.duration));
  const value = getScalar(node.value);
  const unit =
    getScalar((node as Record<string, unknown>)["@_uom"]) ??
    getScalar(node.uom) ??
    getScalar(node.unit) ??
    getScalar(node.units);

  if (start && value) {
    return {
      timestamp: start,
      durationSeconds: duration ?? undefined,
      value,
      unit,
    };
  }

  const intervalNode = getFirstObject(node.interval) ?? getFirstObject(node.timePeriod);
  if (intervalNode) {
    const intervalStart = getScalar(intervalNode.start);
    const intervalDuration = parseIntOrNull(getScalar(intervalNode.duration));
    const intervalValue =
      value ?? getScalar((node as Record<string, unknown>).readingValue) ?? getScalar(node.amount);

    if (intervalStart && intervalValue) {
      const intervalUnit =
        unit ??
        getScalar(intervalNode["@_uom"]) ??
        getScalar(intervalNode.uom) ??
        getScalar(intervalNode.unit);
      return {
        timestamp: intervalStart,
        durationSeconds: intervalDuration ?? undefined,
        value: intervalValue,
        unit: intervalUnit,
      };
    }
  }

  return null;
}

function getFirstObject(value: unknown): Record<string, unknown> | null {
  if (!value) return null;
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = getFirstObject(item);
      if (found) {
        return found;
      }
    }
    return null;
  }
  if (typeof value === "object") {
    return value as Record<string, unknown>;
  }
  return null;
}

function findFirstScalar(node: unknown, key: string): string | null {
  if (!node) return null;
  if (Array.isArray(node)) {
    for (const entry of node) {
      const found = findFirstScalar(entry, key);
      if (found !== null) return found;
    }
    return null;
  }
  if (typeof node !== "object") return null;

  const record = node as Record<string, unknown>;
  if (key in record) {
    const scalar = getScalar(record[key]);
    if (scalar !== null) {
      return scalar;
    }
  }

  for (const value of Object.values(record)) {
    const found = findFirstScalar(value, key);
    if (found !== null) return found;
  }

  return null;
}

function getScalar(value: unknown): string | null {
  if (value === null || value === undefined) {
    return null;
  }

  if (Array.isArray(value)) {
    for (const entry of value) {
      const candidate = getScalar(entry);
      if (candidate !== null) {
        return candidate;
      }
    }
    return null;
  }

  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    if ("#text" in record) {
      return getScalar(record["#text"]);
    }
    if ("_text" in record) {
      return getScalar(record["_text"]);
    }
    if ("value" in record) {
      return getScalar(record.value);
    }
    return null;
  }

  const text = String(value).trim();
  return text.length > 0 ? text : null;
}

function parseIntOrNull(value: string | null): number | null {
  if (value === null) return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function parseGreenButtonCsv(content: string, warnings: string[]): GreenButtonRawReading[] {
  const lines = content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("#"));

  if (lines.length === 0) {
    return [];
  }

  const delimiter = detectDelimiter(lines[0]);
  const [headerLine, ...dataLines] = lines;
  const headers = headerLine
    .split(delimiter)
    .map((h) => h.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_"));

  const readings: GreenButtonRawReading[] = [];
  for (const dataLine of dataLines) {
    const columns = dataLine.split(delimiter).map((value) => value.trim());
    if (columns.length === 0) continue;
    if (columns.length === 1 && !headers.includes("timestamp")) {
      continue;
    }

    const row: Record<string, string> = {};
    for (let i = 0; i < headers.length; i += 1) {
      row[headers[i]] = columns[i] ?? "";
    }

    const timestamp =
      row.timestamp ||
      row.start ||
      row.interval_start ||
      row.start_time ||
      row.begin_datetime ||
      row.begin_date ||
      row.time ||
      "";
    const endTimestamp =
      row.end || row.interval_end || row.end_time || row.stop || row.end_datetime || row.end_date || "";
    const value = row.value || row.consumption || row.kwh || row.usage || row.reading || columns[1] || "";
    const unit = row.unit || row.units || row.measure || null;
    const durationSeconds =
      parseNumber(row.duration_seconds) ||
      parseNumber(row.duration) ||
      parseNumber(row.interval_seconds) ||
      parseNumber(row.seconds) ||
      inferDuration(timestamp, endTimestamp);

    if (!timestamp || !value) {
      continue;
    }

    readings.push({
      timestamp,
      value,
      unit,
      durationSeconds: durationSeconds ?? undefined,
    });
  }

  if (readings.length === 0) {
    warnings.push("CSV parsed successfully, but no usable rows were found.");
  }

  return readings;
}

function detectDelimiter(line: string): string {
  if (line.includes(",")) return ",";
  if (line.includes("\t")) return "\t";
  if (line.includes(";")) return ";";
  return ",";
}

function parseNumber(value?: string): number | null {
  if (!value) return null;
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return null;
  }
  return numeric;
}

function inferDuration(start: string, end: string): number | null {
  if (!start || !end) return null;
  const startDate = new Date(start);
  const endDate = new Date(end);
  if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) {
    return null;
  }
  const diff = Math.floor((endDate.getTime() - startDate.getTime()) / 1000);
  return diff > 0 ? diff : null;
}

function parseGreenButtonJson(content: string, warnings: string[]): GreenButtonRawReading[] {
  try {
    const parsed = JSON.parse(content);
    if (Array.isArray(parsed)) {
      return parsed.flatMap((item) => mapJsonToReading(item));
    }
    return mapJsonToReading(parsed);
  } catch (error) {
    warnings.push(`JSON parse failed: ${(error as Error)?.message ?? error}`);
    return [];
  }
}

function mapJsonToReading(value: any): GreenButtonRawReading[] {
  if (!value || typeof value !== "object") return [];
  const candidate: GreenButtonRawReading = {
    timestamp:
      value.timestamp ??
      value.start ??
      value.time ??
      value.intervalStart ??
      value.start_time ??
      value.begin_datetime ??
      "",
    durationSeconds:
      value.durationSeconds ??
      value.duration ??
      value.intervalSeconds ??
      value.duration_seconds ??
      null,
    value: value.value ?? value.usage ?? value.kwh ?? value.wh ?? 0,
    unit: value.unit ?? value.units ?? value.measure ?? null,
  };
  if (!candidate.timestamp || candidate.value === undefined || candidate.value === null) {
    return [];
  }
  return [candidate];
}


