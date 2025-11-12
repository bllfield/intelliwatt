export type ParsedInterval = {
  esiid?: string | null;
  meter?: string | null;
  startLocal?: string | null;
  endLocal?: string | null;
  dateTimeLocal?: string | null;
  kwh?: number | null;
};

function splitCsvRows(csv: string): string[][] {
  const rows: string[][] = [];
  let currentField = '';
  let currentRow: string[] = [];
  let inQuotes = false;

  for (let i = 0; i < csv.length; i += 1) {
    const char = csv[i];

    if (char === '"') {
      const next = csv[i + 1];
      if (inQuotes && next === '"') {
        currentField += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (char === ',' && !inQuotes) {
      currentRow.push(currentField);
      currentField = '';
      continue;
    }

    if ((char === '\n' || char === '\r') && !inQuotes) {
      if (char === '\r' && csv[i + 1] === '\n') {
        i += 1;
      }
      currentRow.push(currentField);
      if (currentRow.some((cell) => cell.trim().length > 0)) {
        rows.push(currentRow);
      }
      currentRow = [];
      currentField = '';
      continue;
    }

    currentField += char;
  }

  currentRow.push(currentField);
  if (currentRow.some((cell) => cell.trim().length > 0)) {
    rows.push(currentRow);
  }

  return rows;
}

function sanitizeKey(key: string): string {
  return key
    .toLowerCase()
    .replace(/\s+/g, '')
    .replace(/[\/_().-]/g, '')
    .replace(/:/g, '')
    .replace(/\u00a0/g, '') // NBSP safety
    .trim();
}

function toNumber(value: string | number | null | undefined): number | null {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return null;
    const parsed = Number(trimmed.replace(/,/g, ''));
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

export function parseSmtCsvFlexible(csv: string): ParsedInterval[] {
  if (!csv) return [];
  const rows = splitCsvRows(csv);
  if (rows.length === 0) return [];

  const header = rows[0];
  const dataRows = rows.slice(1);
  if (header.length === 0) return [];

  const sanitizedHeaders = header.map(sanitizeKey);

  const results: ParsedInterval[] = [];

  for (const row of dataRows) {
    if (!row || row.every((cell) => !cell || !cell.trim())) {
      continue;
    }

    while (row.length < header.length) {
      row.push('');
    }

    const findValue = (...fragments: string[]): string | undefined => {
      for (const fragment of fragments) {
        const idx = sanitizedHeaders.findIndex((key) => key.includes(fragment));
        if (idx !== -1) {
          const raw = row[idx];
          if (typeof raw === 'string') {
            const trimmed = raw.trim();
            if (trimmed.length > 0) return trimmed;
          }
        }
      }
      return undefined;
    };

    const esiid = findValue('esiid', 'esi');
    const meter = findValue('meter', 'meterid');
    const start = findValue('intervalstart', 'startdatetime', 'startdate', 'starttime');
    const end = findValue('intervalend', 'enddatetime', 'enddate', 'endtime');
    const single = findValue('datetime', 'datetimecst', 'datetimecdt', 'date/time', 'datetimect');
    const kwhRaw = findValue('usagekwh', 'kwh', 'usage');
    const kwh = toNumber(kwhRaw ?? null);

    if (kwh === null) continue;

    results.push({
      esiid: esiid ?? null,
      meter: meter ?? null,
      startLocal: start ?? null,
      endLocal: end ?? null,
      dateTimeLocal: single ?? null,
      kwh,
    });
  }

  return results;
}
