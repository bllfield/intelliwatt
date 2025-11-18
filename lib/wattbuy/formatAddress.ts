export function formatUnitForWattbuy(rawUnit: string | null | undefined): string | null {
  if (typeof rawUnit !== 'string') return null;
  const collapsed = rawUnit.replace(/\s+/g, ' ').trim();
  if (!collapsed) return null;

  const lower = collapsed.toLowerCase();
  const knownPrefixes = ['apt', 'apartment', 'unit', 'suite', 'ste', 'building', 'bldg'];

  // Handle leading # by converting to Apt <number>
  if (collapsed.startsWith('#')) {
    const value = collapsed.slice(1).trim();
    if (!value) return null;
    return `Apt ${value}`;
  }

  // Already contains a descriptive prefix
  if (knownPrefixes.some((prefix) => lower.startsWith(prefix))) {
    return collapsed;
  }

  // Contains alphabetic characters (e.g. "B2" or "North Tower")
  const alphaPortion = lower.replace(/[^a-z]/g, '').trim();
  if (alphaPortion.length > 0) {
    return collapsed;
  }

  // Default fallback: prefix with Apt
  return `Apt ${collapsed}`;
}

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

export function composeWattbuyAddress(line1: string, unit?: string | null): string {
  let base = normalizeWhitespace(line1 ?? '');
  if (base.endsWith(',')) {
    base = base.replace(/,\s*$/g, '');
  }
  const formattedUnit = formatUnitForWattbuy(unit);
  if (!formattedUnit) {
    return base;
  }

  if (!base) {
    return formattedUnit;
  }

  const baseLower = base.toLowerCase();
  const formattedLower = formattedUnit.toLowerCase();

  // If base already ends with ", <unit>" (case-insensitive), respect it.
  if (baseLower.endsWith(`, ${formattedLower}`) || baseLower.includes(` ${formattedLower}`)) {
    return base;
  }

  // If base already contains any known unit prefix with the same identifier, avoid duplication.
  const strippedUnit = formattedUnit.replace(/^(apt|apartment|unit|suite|ste|building|bldg)\s+/i, '').trim();
  if (strippedUnit) {
    const strippedLower = strippedUnit.toLowerCase();
    if (
      baseLower.includes(strippedLower) &&
      /(apt|apartment|unit|suite|ste|building|bldg|#)\s*/i.test(base)
    ) {
      return base;
    }
  }

  return `${base}, ${formattedUnit}`;
}


