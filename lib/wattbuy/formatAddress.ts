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

export function composeWattbuyAddress(line1: string, unit?: string | null): string {
  const base = (line1 ?? '').trim();
  const formattedUnit = formatUnitForWattbuy(unit);
  return formattedUnit ? `${base}, ${formattedUnit}` : base;
}


