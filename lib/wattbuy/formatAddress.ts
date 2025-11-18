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
  const unitPattern = /(,?\s*(?:apt|apartment|unit|suite|ste|building|bldg|#)\s*[A-Za-z0-9#-]+(?:\s+[A-Za-z0-9#-]+)*)$/i;

  let formattedUnit = formatUnitForWattbuy(unit);

  if (!formattedUnit) {
    const unitMatch = base.match(unitPattern);
    if (unitMatch) {
      formattedUnit = formatUnitForWattbuy(unitMatch[0].replace(/^,\s*/g, ''));
    }
  }

  if (!formattedUnit) {
    return base;
  }

  let baseWithoutUnit = base;
  if (unitPattern.test(baseWithoutUnit)) {
    baseWithoutUnit = baseWithoutUnit.replace(unitPattern, '').trim();
  }

  if (!baseWithoutUnit) {
    return formattedUnit;
  }

  if (baseWithoutUnit.endsWith(',')) {
    baseWithoutUnit = baseWithoutUnit.replace(/,\s*$/g, '');
  }

  return `${baseWithoutUnit}, ${formattedUnit}`;
}


