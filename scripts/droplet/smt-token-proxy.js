const http = require('http');
const https = require('https');
const { URL } = require('url');

const SMT_API_BASE_URL =
  process.env.SMT_API_BASE_URL || 'https://services.smartmetertexas.net';
const SMT_USERNAME = process.env.SMT_USERNAME || 'INTELLIWATTAPI';
const SMT_PASSWORD = process.env.SMT_PASSWORD || '';
const SMT_PROXY_TOKEN = process.env.SMT_PROXY_TOKEN || '';
const SMT_PROXY_PORT = parseInt(process.env.SMT_PROXY_PORT || '4101', 10);

if (!SMT_PROXY_TOKEN) {
  console.warn(
    '[smt-token-proxy] WARNING: SMT_PROXY_TOKEN is not set. All requests will fail with 500 until configured.',
  );
}

if (!SMT_PASSWORD) {
  console.warn(
    '[smt-token-proxy] WARNING: SMT_PASSWORD is not set. All token requests will fail with 500 until configured.',
  );
}

function sendJson(res, statusCode, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(statusCode, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(body),
  });
  res.end(body);
}

function readRequestBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function callSmtTokenEndpoint() {
  return new Promise((resolve, reject) => {
    let smtUrl;
    try {
      smtUrl = new URL('/v2/token/', SMT_API_BASE_URL);
    } catch (err) {
      return reject(
        new Error(
          `Invalid SMT_API_BASE_URL (${SMT_API_BASE_URL}): ${err.message}`,
        ),
      );
    }

    const bodyObj = { username: SMT_USERNAME, password: SMT_PASSWORD };
    const bodyJson = JSON.stringify(bodyObj);

    const options = {
      method: 'POST',
      hostname: smtUrl.hostname,
      port: smtUrl.port || 443,
      path: smtUrl.pathname,
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(bodyJson),
      },
    };

    const req = https.request(options, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        const buf = Buffer.concat(chunks);
        let parsed;
        try {
          parsed = JSON.parse(buf.toString('utf8') || '{}');
        } catch (err) {
          return reject(
            new Error(
              `Failed to parse SMT token response JSON: ${err.message} (raw=${buf.toString(
                'utf8',
              )})`,
            ),
          );
        }

        resolve({ statusCode: res.statusCode || 500, body: parsed });
      });
    });

    req.on('error', reject);
    req.write(bodyJson);
    req.end();
  });
}

const server = http.createServer(async (req, res) => {
  const start = Date.now();
  const { method, url } = req;

  console.log(
    `[smt-token-proxy] ${method} ${url} from ${req.socket.remoteAddress}`,
  );

  if (method !== 'POST' || !url || !url.startsWith('/admin/smt/token')) {
    return sendJson(res, 404, {
      ok: false,
      error: 'not_found',
      message: 'Use POST /admin/smt/token',
    });
  }

  const headerToken =
    req.headers['x-proxy-token'] ||
    req.headers['x-Proxy-Token'] ||
    req.headers['X-Proxy-Token'];

  if (!SMT_PROXY_TOKEN || !SMT_PASSWORD) {
    console.error(
      '[smt-token-proxy] Missing SMT_PROXY_TOKEN and/or SMT_PASSWORD env vars.',
    );
    return sendJson(res, 500, {
      ok: false,
      error: 'config_error',
      message:
        'SMT_PROXY_TOKEN and SMT_PASSWORD must be set on the droplet before this endpoint can be used.',
    });
  }

  if (!headerToken || headerToken !== SMT_PROXY_TOKEN) {
    console.warn('[smt-token-proxy] Unauthorized request (bad x-proxy-token).');
    return sendJson(res, 401, {
      ok: false,
      error: 'unauthorized',
      message: 'Invalid or missing x-proxy-token.',
    });
  }

  try {
    await readRequestBody(req);
  } catch (err) {
    console.error('[smt-token-proxy] Failed to read request body:', err);
    return sendJson(res, 400, {
      ok: false,
      error: 'bad_request',
      message: 'Failed to read request body.',
    });
  }

  try {
    const smtResp = await callSmtTokenEndpoint();
    const durationMs = Date.now() - start;

    console.log(
      `[smt-token-proxy] SMT /v2/token/ responded with status ${smtResp.statusCode} in ${durationMs}ms`,
    );

    return sendJson(res, smtResp.statusCode, {
      ok: smtResp.statusCode >= 200 && smtResp.statusCode < 300,
      via: 'smt-token-proxy',
      durationMs,
      smtStatusCode: smtResp.statusCode,
      smtBody: smtResp.body,
    });
  } catch (err) {
    console.error('[smt-token-proxy] Error calling SMT /v2/token/:', err);
    return sendJson(res, 502, {
      ok: false,
      error: 'smt_upstream_error',
      message: 'Failed to obtain SMT token from upstream.',
      details: String(err && err.message ? err.message : err),
    });
  }
});

server.listen(SMT_PROXY_PORT, () => {
  console.log(
    `[smt-token-proxy] Listening on port ${SMT_PROXY_PORT} (SMT_API_BASE_URL=${SMT_API_BASE_URL}, SMT_USERNAME=${SMT_USERNAME})`,
  );
});

