/* eslint-disable no-console */
/**
 * CLI helper to trigger /api/admin/usage/normalize from the command line.
 *
 * Usage (PowerShell, from repo root):
 *   $env:ADMIN_TOKEN = "<admin-token>"
 *   npx ts-node .\scripts\admin\normalizeUsage.ts --esiid=10012345678901234 --source=smt
 *
 * Optional:
 *   $env:ADMIN_BASE_URL = "http://localhost:3000"
 */

type SourceType = 'smt' | 'green_button' | 'manual' | 'other';

interface CliArgs {
  houseId?: string;
  esiid?: string;
  source?: SourceType;
  start?: string;
  end?: string;
}

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = {};

  for (const arg of argv) {
    if (!arg.startsWith('--')) continue;
    const [rawKey, rawValue] = arg.slice(2).split('=');
    const key = rawKey.trim();
    const value = (rawValue ?? '').trim();
    if (!key || !value) continue;

    switch (key) {
      case 'houseId':
        args.houseId = value;
        break;
      case 'esiid':
        args.esiid = value;
        break;
      case 'source':
        if (
          value === 'smt' ||
          value === 'green_button' ||
          value === 'manual' ||
          value === 'other'
        ) {
          args.source = value;
        }
        break;
      case 'start':
        args.start = value;
        break;
      case 'end':
        args.end = value;
        break;
      default:
        // ignore unknown flags
        break;
    }
  }

  return args;
}

async function run() {
  const adminToken = process.env.ADMIN_TOKEN;
  if (!adminToken) {
    console.error(
      'ERROR: ADMIN_TOKEN env var is required to call /api/admin/usage/normalize',
    );
    process.exitCode = 1;
    return;
  }

  const baseUrl =
    process.env.ADMIN_BASE_URL ||
    process.env.NEXT_PUBLIC_BASE_URL ||
    'https://intelliwatt.com';

  const args = parseArgs(process.argv.slice(2));

  if (!args.houseId && !args.esiid) {
    console.error('ERROR: You must supply at least one of --houseId or --esiid');
    console.error(
      'Example: npx ts-node scripts/admin/normalizeUsage.ts --esiid=10012345678901234 --source=smt',
    );
    process.exitCode = 1;
    return;
  }

  const body: Record<string, unknown> = {};
  if (args.houseId) body.houseId = args.houseId;
  if (args.esiid) body.esiid = args.esiid;
  if (args.source) body.source = args.source;
  if (args.start) body.start = args.start;
  if (args.end) body.end = args.end;

  const url = `${baseUrl.replace(/\/+$/, '')}/api/admin/usage/normalize`;

  console.log('Calling:', url);
  console.log('Body:', JSON.stringify(body, null, 2));

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-admin-token': adminToken,
      },
      body: JSON.stringify(body),
    });

    const json = (await res.json()) as any;

    console.log('Status:', res.status);
    console.log('Response:', JSON.stringify(json, null, 2));

    if (!res.ok || !json?.ok) {
      process.exitCode = 1;
    }
  } catch (err) {
    console.error('Request failed:', err);
    process.exitCode = 1;
  }
}

// Node 18+ has global fetch; if not available, this will throw before main.
run().catch((err) => {
  console.error('Unexpected error:', err);
  process.exitCode = 1;
});

