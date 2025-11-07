import 'dotenv/config';

type Args = {
  base?: string;
  token?: string;
  esiid?: string;
  meter?: string;
  dateStart?: string;
  dateEnd?: string;
  out?: string;
};

function parseArgs(argv: string[]): Args {
  const args: Args = {};
  for (let i = 2; i < argv.length; i++) {
    const flag = argv[i];
    if (!flag.startsWith('--')) continue;
    const key = flag.slice(2);
    const value = argv[i + 1];
    (args as any)[key] = value ?? '';
    i++;
  }
  return args;
}

function usage() {
  console.log(`
Usage:
  npm run analysis:daily:csv -- --base "https://intelliwatt.com" --token "<ADMIN_TOKEN>" \
    [--esiid "1044..."] [--meter "M1"] \
    [--dateStart "2025-10-28T00:00:00-05:00"] [--dateEnd "2025-11-06T00:00:00-06:00"] \
    [--out "./daily_summary.csv"]

Notes:
  - If --base/--token are omitted, falls back to PROD_BASE_URL and ADMIN_TOKEN env vars.
  - If no date range is supplied, server defaults to the last 7 full days in America/Chicago.
`);
}

function toCSV(rows: any[]): string {
  const headers = ['date', 'esiid', 'meter', 'found', 'expected', 'completeness'];
  const head = headers.join(',');
  const body = rows
    .map((r) =>
      [
        r.date ?? '',
        r.esiid ?? '',
        r.meter ?? '',
        r.found ?? 0,
        r.expected ?? 0,
        r.completeness ?? 0,
      ]
        .map((cell) => {
          const str = String(cell ?? '');
          return str.includes(',') ? `"${str.replace(/"/g, '""')}"` : str;
        })
        .join(',')
    )
    .join('\n');
  return head + '\n' + body + '\n';
}

async function main() {
  const args = parseArgs(process.argv);
  const BASE = args.base || process.env.PROD_BASE_URL || 'https://intelliwatt.com';
  const TOKEN = args.token || process.env.ADMIN_TOKEN;

  if (!TOKEN) {
    console.error('ERROR: ADMIN_TOKEN not provided (use --token or set env ADMIN_TOKEN).');
    usage();
    process.exit(2);
  }

  const url = new URL('/api/admin/analysis/daily-summary', BASE);
  if (args.esiid) url.searchParams.set('esiid', args.esiid);
  if (args.meter) url.searchParams.set('meter', args.meter);
  if (args.dateStart) url.searchParams.set('dateStart', args.dateStart);
  if (args.dateEnd) url.searchParams.set('dateEnd', args.dateEnd);

  const res = await fetch(url.toString(), {
    headers: { 'x-admin-token': TOKEN },
  });
  if (!res.ok) {
    const text = await res.text();
    console.error('Request failed:', res.status, text);
    process.exit(1);
  }
  const json = await res.json();
  if (!json?.ok) {
    console.error('API error:', JSON.stringify(json));
    process.exit(1);
  }

  const rows = Array.isArray(json.rows) ? json.rows : [];
  const csv = toCSV(rows);
  const outPath = args.out || `./daily_summary_${Date.now()}.csv`;
  const { writeFileSync } = await import('fs');
  writeFileSync(outPath, csv, 'utf8');
  console.log(`Wrote ${rows.length} rows -> ${outPath}`);
}

main().catch((err) => {
  console.error('FATAL:', err?.message || err);
  process.exit(1);
});

