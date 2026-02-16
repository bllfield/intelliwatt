export type ParsedInterval = {
  esiid?: string | null;
  meter?: string | null;
  startLocal?: string | null;
  endLocal?: string | null;
  dateTimeLocal?: string | null;
  kwh?: number | null;
};

type FindValueOptions = {
  /** Reject headers that contain any of these substrings (sanitized header key). */
  rejectIfKeyIncludes?: string[];
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

    const findValueByFragments = (
      fragments: string[],
      options: FindValueOptions = {},
    ): string | undefined => {
      const reject = options.rejectIfKeyIncludes ?? [];

      // Prefer exact sanitized header matches first (more deterministic).
      for (const fragment of fragments) {
        const idx = sanitizedHeaders.findIndex((key) => key === fragment);
        if (idx !== -1) {
          const raw = row[idx];
          if (typeof raw === 'string') {
            const trimmed = raw.trim();
            if (trimmed.length > 0) return trimmed;
          }
        }
      }

      // Then allow "includes" matches, in the caller-provided priority order.
      for (const fragment of fragments) {
        const idx = sanitizedHeaders.findIndex((key) => {
          if (!key.includes(fragment)) return false;
          for (const bad of reject) {
            if (bad && key.includes(bad)) return false;
          }
          return true;
        });
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

    const esiid = findValueByFragments(['esiid', 'esi']);
    const meter = findValueByFragments(['meter', 'meternumber', 'meterid', 'meter_id']);

    // SMT interval exports often split date + time into separate columns.
    // Prefer "read/usage date" for fusing with start/end time when present.
    const usageDate = findValueByFragments(['usagedate', 'readdate', 'readdt', 'readingdate', 'date']);

    // Timestamp selection is order-sensitive:
    // - Prefer full datetime columns over time-only
    // - Prefer time over date (to avoid mistakenly using "Interval End Date" when "Interval End Time" exists)
    // - Avoid the generic "intervalend" until after trying the more specific variants, because it matches both date/time columns.
    const start = findValueByFragments([
      'intervalstartdatetime',
      'startdatetime',
      'intervalstarttime',
      'starttime',
      'intervalstart',
      'start',
      'intervalstartdate',
      'startdate',
    ]);
    const end = findValueByFragments([
      'intervalenddatetime',
      'enddatetime',
      'intervalendtime',
      'endtime',
      'intervalend',
      'end',
      'intervalenddate',
      'enddate',
    ]);
    const single = findValueByFragments([
      'datetimecst',
      'datetimecdt',
      'datetimect',
      'datetime',
      'date/time',
      'datetimestamp',
    ]);

    // kWh selection:
    // Prefer explicit kWh columns; avoid accidentally matching "Usage Type" / similar fields.
    const kwhRaw = findValueByFragments(
      ['usagekwh', 'consumptionkwh', 'kwh', 'kwhusage', 'usage'],
      { rejectIfKeyIncludes: ['type'] },
    );
    const kwh = toNumber(kwhRaw ?? null);

    if (kwh === null) continue;

    // Some SMT extracts split date and time. If we have a usage date, fuse it with start/end.
    const startWithDate = start && usageDate ? `${usageDate} ${start}` : start;
    const endWithDate = end && usageDate ? `${usageDate} ${end}` : end;
    const singleWithDate = single || (usageDate && (start || end) ? `${usageDate} ${start || end}` : undefined);

    results.push({
      esiid: esiid ?? null,
      meter: meter ?? null,
      startLocal: startWithDate ?? null,
      endLocal: endWithDate ?? null,
      dateTimeLocal: singleWithDate ?? null,
      kwh,
    });
  }

  return results;
}
