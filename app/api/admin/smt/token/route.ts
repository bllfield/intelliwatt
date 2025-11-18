import { NextResponse } from 'next/server';
import { headers } from 'next/headers';

const ADMIN_TOKEN = process.env.ADMIN_TOKEN ?? '';

function authorized(): boolean {
  if (!ADMIN_TOKEN) return false;
  const hdrs = headers();
  const headerToken =
    hdrs.get('x-admin-token') ?? hdrs.get('x-Admin-Token') ?? hdrs.get('X-Admin-Token');
  return headerToken === ADMIN_TOKEN;
}

export async function GET() {
  if (!authorized()) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  }

  const body = {
    ok: false,
    status: 501,
    message: 'SMT JWT token must be tested from the whitelisted SMT droplet, not from Vercel.',
    instructions: {
      dropletHost: 'intelliwatt-smt-proxy',
      scriptPath: '/home/deploy/smt_token_test.sh',
      note:
        'This route intentionally returns 501 because SMT only whitelists the droplet IP. Use the droplet script for live JWT verification.',
    },
    integration: {
      endpoint: 'https://services.smartmetertexas.net/v2/token/',
      authFlow: 'POST with { username: SMT_USERNAME, password: SMT_PASSWORD }',
      usernameEnv: 'SMT_USERNAME=INTELLIWATTAPI',
      baseUrlEnv: 'SMT_API_BASE_URL=https://services.smartmetertexas.net',
    },
  };

  return NextResponse.json(body, { status: 501 });
}

