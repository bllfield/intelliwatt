/* eslint-disable no-console */
/**
 * CLI helper for SMT admin tools.
 *
 * Usage examples (PowerShell):
 *   $env:ADMIN_TOKEN = "<token>"
 *   npx ts-node .\scripts\admin\smtAdmin.ts status-agreement --esiid=10012345678901234
 *   npx ts-node .\scripts\admin\smtAdmin.ts list-subscriptions --serviceType=SUBSCRIPTION
 */

type ServiceType = 'ADHOC' | 'SUBSCRIPTION';

interface CliOptions {
  subcommand: string;
  esiid?: string;
  serviceType?: ServiceType;
  correlationId?: string;
  agreementNumber?: string;
  email?: string;
  statusReason?: string;
}

function parseCli(argv: string[]): CliOptions {
  const [subcommand = ''] = argv;
  const opts: CliOptions = { subcommand };

  for (const arg of argv.slice(1)) {
    if (!arg.startsWith('--')) continue;
    const [rawKey, rawValue] = arg.slice(2).split('=');
    const key = rawKey.trim();
    const value = (rawValue ?? '').trim();
    if (!key || !value) continue;

    switch (key) {
      case 'esiid':
        opts.esiid = value;
        break;
      case 'serviceType':
        if (value === 'ADHOC' || value === 'SUBSCRIPTION') {
          opts.serviceType = value;
        }
        break;
      case 'correlationId':
        opts.correlationId = value;
        break;
      case 'agreementNumber':
        opts.agreementNumber = value;
        break;
      case 'email':
        opts.email = value;
        break;
      case 'statusReason':
        opts.statusReason = value;
        break;
      default:
        break;
    }
  }

  return opts;
}

function requireEnvToken(): string {
  const token = process.env.ADMIN_TOKEN;
  if (!token) {
    console.error('ERROR: ADMIN_TOKEN env var is required.');
    process.exitCode = 1;
    throw new Error('ADMIN_TOKEN missing');
  }
  return token;
}

function resolveBaseUrl(): string {
  const base =
    process.env.ADMIN_BASE_URL ||
    process.env.NEXT_PUBLIC_BASE_URL ||
    'https://intelliwatt.com';
  return base.replace(/\/+$/, '');
}

async function callAdmin(
  path: string,
  body: Record<string, unknown>,
): Promise<void> {
  const token = requireEnvToken();
  const baseUrl = resolveBaseUrl();
  const url = `${baseUrl}${path}`;

  console.log('Calling:', url);
  console.log('Body:', JSON.stringify(body, null, 2));

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-admin-token': token,
      },
      body: JSON.stringify(body),
    });

    const json = await res.json();
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

function printHelp(): void {
  console.log('Usage: ts-node scripts/admin/smtAdmin.ts <subcommand> [options]');
  console.log('');
  console.log('Subcommands:');
  console.log('  status-agreement      --esiid=<ESIID>');
  console.log('  cancel-agreement      --esiid=<ESIID>');
  console.log('  list-subscriptions    [--serviceType=ADHOC|SUBSCRIPTION]');
  console.log(
    '  report-status         --correlationId=<id> [--serviceType=ADHOC|SUBSCRIPTION]',
  );
  console.log('  agreement-esiids      --agreementNumber=<number>');
  console.log(
    '  terminate-agreement   --agreementNumber=<number> --email=<retailCustomerEmail>',
  );
  console.log(
    '  my-agreements         [--agreementNumber=<number>] [--statusReason=PEN|ACT|COM|NACOM]',
  );
  console.log('');
}

async function main() {
  const argv = process.argv.slice(2);
  if (argv.length === 0) {
    printHelp();
    process.exitCode = 1;
    return;
  }

  const opts = parseCli(argv);

  switch (opts.subcommand) {
    case 'status-agreement': {
      if (!opts.esiid) {
        console.error('ERROR: --esiid is required for status-agreement');
        process.exitCode = 1;
        return;
      }
      await callAdmin('/api/admin/smt/agreements/status', { esiid: opts.esiid });
      return;
    }
    case 'cancel-agreement': {
      if (!opts.esiid) {
        console.error('ERROR: --esiid is required for cancel-agreement');
        process.exitCode = 1;
        return;
      }
      await callAdmin('/api/admin/smt/agreements/cancel', { esiid: opts.esiid });
      return;
    }
    case 'list-subscriptions': {
      const body: Record<string, unknown> = {};
      if (opts.serviceType) body.serviceType = opts.serviceType;
      await callAdmin('/api/admin/smt/subscriptions/list', body);
      return;
    }
    case 'report-status': {
      if (!opts.correlationId) {
        console.error('ERROR: --correlationId is required for report-status');
        process.exitCode = 1;
        return;
      }
      const body: Record<string, unknown> = { correlationId: opts.correlationId };
      if (opts.serviceType) body.serviceType = opts.serviceType;
      await callAdmin('/api/admin/smt/report-status', body);
      return;
    }
    case 'agreement-esiids': {
      if (!opts.agreementNumber) {
        console.error('ERROR: --agreementNumber is required for agreement-esiids');
        process.exitCode = 1;
        return;
      }
      await callAdmin('/api/admin/smt/agreements/esiids', {
        agreementNumber: opts.agreementNumber,
      });
      return;
    }
    case 'terminate-agreement': {
      if (!opts.agreementNumber) {
        console.error(
          'ERROR: --agreementNumber is required for terminate-agreement',
        );
        process.exitCode = 1;
        return;
      }
      if (!opts.email) {
        console.error('ERROR: --email is required for terminate-agreement');
        process.exitCode = 1;
        return;
      }
      await callAdmin('/api/admin/smt/agreements/terminate', {
        agreementNumber: opts.agreementNumber,
        retailCustomerEmail: opts.email,
      });
      return;
    }
    case 'my-agreements': {
      const body: Record<string, unknown> = {};
      if (opts.agreementNumber) body.agreementNumber = opts.agreementNumber;
      if (opts.statusReason) body.statusReason = opts.statusReason;
      await callAdmin('/api/admin/smt/agreements/myagreements', body);
      return;
    }
    default:
      console.error(`Unknown subcommand: ${opts.subcommand}`);
      printHelp();
      process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error('Unexpected error:', err);
  process.exitCode = 1;
});


