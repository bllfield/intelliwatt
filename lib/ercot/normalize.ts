/**
 * Minimal USPS-like address normalization for line1/city/zip.
 * - Uppercase, trim, collapse whitespace
 * - Strip punctuation except numbers/letters and space
 * - Expand common suffixes: STREET->ST, ROAD->RD, DRIVE->DR, AVENUE->AVE, LANE->LN, COURT->CT, PARKWAY->PKWY, HIGHWAY->HWY
 * - Normalize ordinal suffixes (e.g., "1ST" stays "1ST"; we mainly clean spaces/punct)
 */
const SUFFIX_MAP: Record<string, string> = {
  STREET: "ST",
  ST: "ST",
  ROAD: "RD",
  RD: "RD",
  DRIVE: "DR",
  DR: "DR",
  AVENUE: "AVE",
  AVE: "AVE",
  LANE: "LN",
  LN: "LN",
  COURT: "CT",
  CT: "CT",
  PARKWAY: "PKWY",
  PKWY: "PKWY",
  HIGHWAY: "HWY",
  HWY: "HWY",
  BOULEVARD: "BLVD",
  BLVD: "BLVD",
  PLACE: "PL",
  PL: "PL",
  TERRACE: "TER",
  TER: "TER",
  CIRCLE: "CIR",
  CIR: "CIR",
  DRIVEWAY: "DR",
};

export function normalizeLine1(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let s = raw.toUpperCase().trim();

  // Remove punctuation except letters/numbers/space
  s = s.replace(/[^A-Z0-9\s]/g, " ");

  // Collapse whitespace
  s = s.replace(/\s+/g, " ").trim();

  // Expand common street suffix at end token
  const parts = s.split(" ");
  if (parts.length) {
    const last = parts[parts.length - 1];
    const mapped = SUFFIX_MAP[last];
    if (mapped) parts[parts.length - 1] = mapped;
  }
  s = parts.join(" ");

  return s || null;
}

export function normalizeCity(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let s = raw.toUpperCase().trim();
  s = s.replace(/[^A-Z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
  return s || null;
}

export function normalizeZip(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let s = raw.trim();
  // Keep 5 or 9 digits (ZIP+4 allowed, strip dash)
  s = s.replace(/-/g, "");
  if (!/^\d{5}(\d{4})?$/.test(s)) return null;
  return s;
}

export function normalizeAddress(input: {
  line1?: string | null;
  city?: string | null;
  zip?: string | null;
}) {
  return {
    normLine1: normalizeLine1(input.line1 ?? null),
    normCity: normalizeCity(input.city ?? null),
    normZip: normalizeZip(input.zip ?? null),
  };
}

