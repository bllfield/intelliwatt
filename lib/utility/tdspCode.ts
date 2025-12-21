export type TdspCodeCanonical =
  | "ONCOR"
  | "CENTERPOINT"
  | "AEP_NORTH"
  | "AEP_CENTRAL"
  | "TNMP";

/**
 * Normalize a TDSP identifier from many possible sources into our canonical `TdspCode` enum values.
 *
 * Accepts:
 * - Canonical codes: ONCOR, CENTERPOINT, AEP_NORTH, AEP_CENTRAL, TNMP
 * - Common abbreviations seen in upstream feeds / legacy fields: AEPNOR, AEPCEN
 * - Common slugs: oncor, centerpoint, aep_n, aep_c, tnmp
 * - Common verbose strings: "AEP Texas North Company", "AEP Texas Central Company", "Texas New Mexico Power"
 */
export function normalizeTdspCode(input: unknown): TdspCodeCanonical | null {
  const raw = String(input ?? "").trim();
  if (!raw) return null;

  // Keep both a strict upper variant and a slug-like variant.
  const upper = raw.toUpperCase().replace(/\s+/g, " ").trim();
  const slug = raw
    .toLowerCase()
    .trim()
    .replace(/[\s]+/g, "_")
    .replace(/-+/g, "_");

  // Canonical already.
  if (upper === "ONCOR") return "ONCOR";
  if (upper === "CENTERPOINT") return "CENTERPOINT";
  if (upper === "TNMP") return "TNMP";
  if (upper === "AEP_NORTH") return "AEP_NORTH";
  if (upper === "AEP_CENTRAL") return "AEP_CENTRAL";

  // Legacy / shortened codes seen in some datasets.
  if (upper === "AEPNOR" || upper === "AEP_NOR" || upper === "AEP NOR") return "AEP_NORTH";
  if (upper === "AEPCEN" || upper === "AEP_CEN" || upper === "AEP CEN") return "AEP_CENTRAL";

  // Slug variants.
  if (slug === "oncor") return "ONCOR";
  if (slug === "centerpoint" || slug === "cnp") return "CENTERPOINT";
  if (slug === "tnmp") return "TNMP";
  if (
    slug === "aep_n" ||
    slug === "aep_north" ||
    slug === "aep_texas_north" ||
    slug === "aep_texas_n"
  )
    return "AEP_NORTH";
  if (
    slug === "aep_c" ||
    slug === "aep_central" ||
    slug === "aep_texas_central" ||
    slug === "aep_texas_c"
  )
    return "AEP_CENTRAL";

  // Verbose names / text snippets.
  const norm = raw.toLowerCase();
  if (norm.includes("oncor")) return "ONCOR";
  if (norm.includes("centerpoint") || norm.includes("center point")) return "CENTERPOINT";
  if (norm.includes("tnmp") || /\btexas\s*-?\s*new\s+mexico\s+power\b/i.test(raw)) return "TNMP";
  if (norm.includes("aep") && norm.includes("north")) return "AEP_NORTH";
  if (norm.includes("aep") && (norm.includes("central") || norm.includes("south"))) return "AEP_CENTRAL";

  return null;
}

