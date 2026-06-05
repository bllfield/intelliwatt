import { DateTime } from "luxon";
import { XMLParser } from "fast-xml-parser";
import { GreenButtonRawReading } from "./greenButtonNormalize";

export type GreenButtonParsedIntervalBlock = {
  /** Chicago local service calendar day from IntervalBlock interval start date label. */
  serviceDateKey: string;
  readings: GreenButtonRawReading[];
  blockStartEpochSeconds?: number;
};

export type GreenButtonXmlParseMode =
  | "xml_full_tree"
  | "xml_interval_blocks"
  | "xml_sequential_interval_blocks";

export type ParsedGreenButtonResult = {
  /** Detected source format */
  format: "xml" | "csv" | "json" | "unknown";
  /** Raw readings extracted from the file */
  readings: GreenButtonRawReading[];
  /** ESPI IntervalBlock rows when sequential local-day slotting applies. */
  intervalBlocks?: GreenButtonParsedIntervalBlock[];
  slottingMode?: "epoch_bucket" | "sequential_local_day";
  /** Metadata extracted from the file (best-effort) */
  metadata: {
    timezoneOffsetSeconds: number | null;
    meterSerialNumber: string | null;
    sourceTitle: string | null;
    totalReadings: number;
    parseMode?: GreenButtonXmlParseMode;
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
const LARGE_XML_INTERVAL_BLOCK_THRESHOLD_BYTES = 512 * 1024;
const XML_BLOCK_PARSE_PROGRESS_EVERY = 2000;

export function parseGreenButtonBuffer(
  buffer: Buffer,
  filename?: string | null,
  options?: {
    onXmlParseProgress?: (detail: { blocksScanned: number; readingsFound: number }) => void;
  }
): ParsedGreenButtonResult {
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
  let intervalBlocks: GreenButtonParsedIntervalBlock[] | undefined;
  let slottingMode: ParsedGreenButtonResult["slottingMode"];
  let metadata: ParsedGreenButtonResult["metadata"] = {
    timezoneOffsetSeconds: null,
    meterSerialNumber: null,
    sourceTitle: null,
    totalReadings: 0,
    parseMode: undefined,
  };

  try {
    if (format === "xml") {
      const useLargeParser = content.length >= LARGE_XML_INTERVAL_BLOCK_THRESHOLD_BYTES;
      const xmlResult = useLargeParser
        ? parseGreenButtonXmlLarge(content, options?.onXmlParseProgress)
        : parseGreenButtonXml(content);
      readings = xmlResult.readings;
      intervalBlocks = xmlResult.intervalBlocks;
      slottingMode = xmlResult.slottingMode;
      metadata = {
        timezoneOffsetSeconds: xmlResult.timezoneOffsetSeconds,
        meterSerialNumber: xmlResult.meterSerialNumber,
        sourceTitle: xmlResult.sourceTitle,
        totalReadings: readings.length,
        parseMode: xmlResult.parseMode,
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
    intervalBlocks,
    slottingMode,
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
  intervalBlocks?: GreenButtonParsedIntervalBlock[];
  slottingMode?: ParsedGreenButtonResult["slottingMode"];
  timezoneOffsetSeconds: number | null;
  meterSerialNumber: string | null;
  sourceTitle: string | null;
  warnings: string[];
  parseMode?: GreenButtonXmlParseMode;
};

function intervalBlockServiceDateKey(blockStartEpochSeconds: number): string | null {
  if (!Number.isFinite(blockStartEpochSeconds)) return null;
  const dt = DateTime.fromSeconds(Math.trunc(blockStartEpochSeconds), { zone: "utc" });
  return dt.isValid ? dt.toFormat("yyyy-MM-dd") : null;
}

function flattenIntervalBlockReadings(blocks: GreenButtonParsedIntervalBlock[]): GreenButtonRawReading[] {
  return blocks.flatMap((block) => block.readings);
}

function readingFromIntervalBlockNode(
  node: Record<string, unknown>,
  defaultUnit: string | null,
): GreenButtonRawReading | null {
  const reading = readingFromNode(node, defaultUnit);
  if (!reading) return null;

  const intervalNode = getFirstObject(node.interval) ?? getFirstObject(node.timePeriod);
  const rawStart = parseIntOrNull(getScalar(intervalNode?.start));
  if (rawStart != null) {
    return { ...reading, rawXmlStartSeconds: rawStart };
  }
  return reading;
}

function parseIntervalBlockXmlFragment(
  blockXml: string,
  defaultUnit: string | null,
  miniParser: XMLParser,
): GreenButtonParsedIntervalBlock | null {
  const blockStartRaw = blockXml.match(/<interval>[\s\S]*?<start>(\d+)<\/start>/i)?.[1];
  const blockStartEpochSeconds = parseIntOrNull(blockStartRaw ?? null);
  if (blockStartEpochSeconds == null) return null;

  const serviceDateKey = intervalBlockServiceDateKey(blockStartEpochSeconds);
  if (!serviceDateKey) return null;

  const readings: GreenButtonRawReading[] = [];
  const readingRe = /<IntervalReading\b[^>]*>[\s\S]*?<\/IntervalReading>/gi;
  let readingMatch: RegExpExecArray | null;
  while ((readingMatch = readingRe.exec(blockXml)) !== null) {
    try {
      const wrapped = miniParser.parse(`<ir>${readingMatch[0]}</ir>`) as { ir?: Record<string, unknown> };
      const node = intervalReadingNodeFromWrappedBlock(wrapped?.ir ?? {});
      const reading = readingFromIntervalBlockNode(node, defaultUnit);
      if (reading) readings.push(reading);
    } catch {
      // skip malformed reading
    }
  }

  if (readings.length === 0) return null;

  return {
    serviceDateKey,
    readings,
    blockStartEpochSeconds,
  };
}

function parseGreenButtonXmlSequentialIntervalBlocksLarge(
  xml: string,
  onProgress?: (detail: { blocksScanned: number; readingsFound: number }) => void,
): XmlParseResult {
  const warnings: string[] = [];
  const defaultUnit = resolveXmlDefaultReadingUnitFromHeader(xml);
  const intervalBlocks: GreenButtonParsedIntervalBlock[] = [];
  const blockRe = /<IntervalBlock\b[^>]*>[\s\S]*?<\/IntervalBlock>/gi;
  const miniParser = new XMLParser(XML_PARSER_OPTIONS);
  let blocksScanned = 0;
  let match: RegExpExecArray | null;

  while ((match = blockRe.exec(xml)) !== null) {
    blocksScanned += 1;
    const block = parseIntervalBlockXmlFragment(match[0], defaultUnit, miniParser);
    if (block) intervalBlocks.push(block);
    if (blocksScanned % XML_BLOCK_PARSE_PROGRESS_EVERY === 0) {
      onProgress?.({ blocksScanned, readingsFound: flattenIntervalBlockReadings(intervalBlocks).length });
    }
  }

  const readings = flattenIntervalBlockReadings(intervalBlocks);
  onProgress?.({ blocksScanned, readingsFound: readings.length });

  return {
    readings,
    intervalBlocks,
    slottingMode: intervalBlocks.length > 0 ? "sequential_local_day" : undefined,
    timezoneOffsetSeconds: parseIntOrNull(xml.match(/<tzOffset>\s*([^<]+)\s*<\/tzOffset>/i)?.[1] ?? null),
    meterSerialNumber: xml.match(/<meterSerialNumber>\s*([^<]+)\s*<\/meterSerialNumber>/i)?.[1]?.trim() ?? null,
    sourceTitle: xml.match(/<title>\s*([^<]+)\s*<\/title>/i)?.[1]?.trim() ?? null,
    warnings,
    parseMode: intervalBlocks.length > 0 ? "xml_sequential_interval_blocks" : undefined,
  };
}

function collectXmlIntervalBlocks(
  node: unknown,
  out: GreenButtonParsedIntervalBlock[],
  defaultUnit: string | null,
): void {
  if (!node) return;
  if (Array.isArray(node)) {
    for (const entry of node) collectXmlIntervalBlocks(entry, out, defaultUnit);
    return;
  }
  if (typeof node !== "object") return;

  const record = node as Record<string, unknown>;
  if ("IntervalBlock" in record) {
    const blocks = record.IntervalBlock;
    const blockList = Array.isArray(blocks) ? blocks : blocks ? [blocks] : [];
    for (const blockNode of blockList) {
      if (!blockNode || typeof blockNode !== "object") continue;
      const blockRecord = blockNode as Record<string, unknown>;
      const intervalNode = getFirstObject(blockRecord.interval);
      const blockStartEpochSeconds = parseIntOrNull(getScalar(intervalNode?.start));
      if (blockStartEpochSeconds == null) continue;
      const serviceDateKey = intervalBlockServiceDateKey(blockStartEpochSeconds);
      if (!serviceDateKey) continue;

      const readings: GreenButtonRawReading[] = [];
      const readingNodes = blockRecord.IntervalReading;
      const readingList = Array.isArray(readingNodes) ? readingNodes : readingNodes ? [readingNodes] : [];
      for (const readingNode of readingList) {
        if (!readingNode || typeof readingNode !== "object") continue;
        const reading = readingFromIntervalBlockNode(readingNode as Record<string, unknown>, defaultUnit);
        if (reading) readings.push(reading);
      }
      if (readings.length > 0) {
        out.push({ serviceDateKey, readings, blockStartEpochSeconds });
      }
    }
  }

  for (const value of Object.values(record)) {
    collectXmlIntervalBlocks(value, out, defaultUnit);
  }
}

/** ESPI uom 72 = watt-hours; ReadingType often appears after IntervalReading blocks on SMT exports. */
function resolveEspiWhKwhFromUom72(xml: string): "Wh" | "kWh" | null {
  if (!/<uom>\s*72\s*<\/uom>/i.test(xml)) return null;
  if (/<powerOfTenMultiplier>\s*3\s*<\/powerOfTenMultiplier>/i.test(xml)) return "kWh";
  return "Wh";
}

function resolveXmlDefaultReadingUnitFromHeader(xml: string): string | null {
  const fromUom = resolveEspiWhKwhFromUom72(xml);
  if (fromUom) return fromUom;

  const head = xml.slice(0, 250_000);
  const tail = xml.length > head.length ? xml.slice(-250_000) : "";
  for (const slice of tail === head ? [head] : [head, tail]) {
    const fromSliceUom = resolveEspiWhKwhFromUom72(slice);
    if (fromSliceUom) return fromSliceUom;
    const titleMatch = slice.match(/<title>([^<]*)<\/title>/i);
    const title = titleMatch?.[1] ?? null;
    if (/\bKWH\b/i.test(String(title ?? ""))) return "kWh";
    if (/\bWH\b/i.test(String(title ?? ""))) return "Wh";
  }

  if (/SMT Green Button Report:\s*Interval/i.test(head)) {
    return "Wh";
  }

  return null;
}

function intervalReadingNodeFromWrappedBlock(wrappedRoot: Record<string, unknown>): Record<string, unknown> {
  const direct = getFirstObject(wrappedRoot.IntervalReading);
  return direct ?? wrappedRoot;
}

/**
 * Large ESPI files: scan IntervalReading blocks without building one giant XML tree.
 * Falls back to full-tree parse when block scan finds too few readings.
 */
function parseGreenButtonXmlLarge(
  xml: string,
  onProgress?: (detail: { blocksScanned: number; readingsFound: number }) => void
): XmlParseResult {
  if (/<IntervalBlock\b/i.test(xml)) {
    const sequential = parseGreenButtonXmlSequentialIntervalBlocksLarge(xml, onProgress);
    if (sequential.intervalBlocks && sequential.intervalBlocks.length > 0) {
      return sequential;
    }
  }

  const warnings: string[] = [];
  const defaultUnit = resolveXmlDefaultReadingUnitFromHeader(xml);
  const readings: GreenButtonRawReading[] = [];
  const blockRe = /<IntervalReading\b[^>]*>[\s\S]*?<\/IntervalReading>/gi;
  const miniParser = new XMLParser(XML_PARSER_OPTIONS);
  let blocksScanned = 0;
  let match: RegExpExecArray | null;

  while ((match = blockRe.exec(xml)) !== null) {
    blocksScanned += 1;
    try {
      const wrapped = miniParser.parse(`<ir>${match[0]}</ir>`) as { ir?: Record<string, unknown> };
      const node = intervalReadingNodeFromWrappedBlock(wrapped?.ir ?? {});
      const reading = readingFromNode(node, defaultUnit);
      if (reading) readings.push(reading);
    } catch {
      // skip malformed block
    }
    if (blocksScanned % XML_BLOCK_PARSE_PROGRESS_EVERY === 0) {
      onProgress?.({ blocksScanned, readingsFound: readings.length });
    }
  }

  onProgress?.({ blocksScanned, readingsFound: readings.length });

  if (readings.length === 0) {
    warnings.push("Interval block scan found no readings; falling back to full XML tree parse.");
    const fallback = parseGreenButtonXml(xml);
    return { ...fallback, parseMode: "xml_full_tree" };
  }

  const expectedBlocks = (xml.match(/<IntervalReading\b/gi) ?? []).length;
  if (expectedBlocks > 100 && readings.length < expectedBlocks * 0.9) {
    warnings.push(
      `Interval block scan recovered ${readings.length}/${expectedBlocks} readings; falling back to full XML tree parse.`
    );
    const fallback = parseGreenButtonXml(xml);
    return { ...fallback, parseMode: "xml_full_tree" };
  }

  if (readings.length === 0) {
    warnings.push("Parsed XML successfully, but no interval readings were found.");
  }

  return {
    readings,
    timezoneOffsetSeconds: parseIntOrNull(xml.match(/<tzOffset>\s*([^<]+)\s*<\/tzOffset>/i)?.[1] ?? null),
    meterSerialNumber: xml.match(/<meterSerialNumber>\s*([^<]+)\s*<\/meterSerialNumber>/i)?.[1]?.trim() ?? null,
    sourceTitle: xml.match(/<title>\s*([^<]+)\s*<\/title>/i)?.[1]?.trim() ?? null,
    warnings,
    parseMode: "xml_interval_blocks",
  };
}

function parseGreenButtonXml(xml: string): XmlParseResult {
  const parser = new XMLParser(XML_PARSER_OPTIONS);
  const warnings: string[] = [];
  let root: any;

  try {
    root = parser.parse(xml);
  } catch (error) {
    throw new Error(`XML parse error: ${(error as Error)?.message ?? error}`);
  }

  const defaultReadingUnit = resolveXmlDefaultReadingUnit(root);
  const intervalBlocks: GreenButtonParsedIntervalBlock[] = [];
  collectXmlIntervalBlocks(root, intervalBlocks, defaultReadingUnit);

  if (intervalBlocks.length > 0) {
    const readings = flattenIntervalBlockReadings(intervalBlocks);
    if (readings.length === 0) {
      warnings.push("Parsed XML successfully, but no interval readings were found.");
    }
    return {
      readings,
      intervalBlocks,
      slottingMode: "sequential_local_day",
      timezoneOffsetSeconds: parseIntOrNull(findFirstScalar(root, "tzOffset")),
      meterSerialNumber: findFirstScalar(root, "meterSerialNumber"),
      sourceTitle: findFirstScalar(root, "title"),
      warnings,
      parseMode: "xml_sequential_interval_blocks",
    };
  }

  const readings: GreenButtonRawReading[] = [];
  collectXmlReadings(root, readings, defaultReadingUnit);

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
    parseMode: "xml_full_tree",
  };
}

function resolveXmlDefaultReadingUnit(root: unknown): string | null {
  const title = findFirstScalar(root, "title");
  const readingType = findFirstNode(root, "ReadingType");
  const uom = getScalar(readingType?.uom);
  const multiplier = getScalar(readingType?.powerOfTenMultiplier);
  if (uom === "72") {
    return multiplier === "3" ? "kWh" : "Wh";
  }
  if (/\bKWH\b/i.test(String(title ?? ""))) return "kWh";
  if (/\bWH\b/i.test(String(title ?? ""))) return "Wh";
  return null;
}

function collectXmlReadings(node: unknown, out: GreenButtonRawReading[], defaultUnit: string | null) {
  if (!node) return;
  if (Array.isArray(node)) {
    for (const entry of node) {
      collectXmlReadings(entry, out, defaultUnit);
    }
    return;
  }

  if (typeof node !== "object") {
    return;
  }

  const reading = readingFromNode(node as Record<string, unknown>, defaultUnit);
  if (reading) {
    out.push(reading);
  }

  for (const value of Object.values(node as Record<string, unknown>)) {
    collectXmlReadings(value, out, defaultUnit);
  }
}

function readingFromNode(node: Record<string, unknown>, defaultUnit: string | null): GreenButtonRawReading | null {
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
      unit: unit ?? defaultUnit,
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
        unit: intervalUnit ?? defaultUnit,
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

function findFirstNode(node: unknown, key: string): Record<string, unknown> | null {
  if (!node) return null;
  if (Array.isArray(node)) {
    for (const entry of node) {
      const found = findFirstNode(entry, key);
      if (found) return found;
    }
    return null;
  }
  if (typeof node !== "object") return null;

  const record = node as Record<string, unknown>;
  if (key in record) {
    const value = record[key];
    if (value && typeof value === "object" && !Array.isArray(value)) return value as Record<string, unknown>;
    const nested = getFirstObject(value);
    if (nested) return nested;
  }
  for (const value of Object.values(record)) {
    const found = findFirstNode(value, key);
    if (found) return found;
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


