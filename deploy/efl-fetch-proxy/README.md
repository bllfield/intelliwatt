# IntelliWatt — EFL Fetch Proxy (Droplet)

This service fetches EFL PDFs from hosts that may block Vercel/AWS IP ranges (403/406) and returns the bytes to the main app.

It is **used automatically** by the main app when:

- `EFL_FETCH_PROXY_URL` is configured in Vercel
- The direct fetch path returns **HTTP 403/406**

## API contract (matches `lib/efl/fetchEflPdf.ts`)

### Request

- **Method**: `POST`
- **Path**: `/efl/fetch`
- **Headers**:
  - `Content-Type: application/json`
  - `Authorization: Bearer <EFL_FETCH_PROXY_TOKEN>` (required only if the proxy has `EFL_FETCH_PROXY_TOKEN` set)
- **Body**:

```json
{ "url": "https://example.com/efl.pdf", "timeoutMs": 20000 }
```

### Response (success)

- **Status**: `200`
- **Body**: raw bytes (PDF or whatever upstream returned)
- **Headers**:
  - `content-type`: upstream content-type
  - `x-final-url`: final URL after redirects (best effort)
  - `x-proxy-notes`: compact telemetry (bytes/ms/maxBytes)

### Response (error)

- **Status**: mirrors upstream HTTP status when possible (e.g., 403/404/429), otherwise `502`
- **Body**: JSON `{ ok:false, error, details }`

## Env vars (proxy server)

See `deploy/efl-fetch-proxy/env.example`.

- `HOST` (default `127.0.0.1`)
- `PORT` (default `8088`)
- `EFL_FETCH_PROXY_TOKEN` (recommended)
- `EFL_FETCH_PROXY_MAX_BYTES` (default 15MB)
- `EFL_FETCH_PROXY_ALLOW_HOSTS` (optional allowlist)

## Local dev (no nginx)

From this folder:

```powershell
npm install
npm run build
$env:HOST="127.0.0.1"
$env:PORT="8088"
$env:EFL_FETCH_PROXY_TOKEN="dev-token"
node dist/server.js
```

Smoke test:

```powershell
$headers = @{ "Authorization" = "Bearer dev-token"; "Content-Type" = "application/json" }
$body = @{ url = "https://example.com/efl.pdf"; timeoutMs = 20000 } | ConvertTo-Json
Invoke-WebRequest -Headers $headers -Method Post -Uri "http://127.0.0.1:8088/efl/fetch" -Body $body -OutFile ".\\out.pdf"
```

## Droplet install (systemd)

These steps assume:

- repo checkout at `/opt/intelliwatt/intelliwatt-clean`
- service deployed at `/opt/intelliwatt/efl-fetch-proxy`

### 1) Copy the service folder

```bash
sudo mkdir -p /opt/intelliwatt
sudo rm -rf /opt/intelliwatt/efl-fetch-proxy
sudo cp -R /opt/intelliwatt/intelliwatt-clean/deploy/efl-fetch-proxy /opt/intelliwatt/efl-fetch-proxy
sudo chown -R deploy:deploy /opt/intelliwatt/efl-fetch-proxy
```

### 2) Install deps + build

```bash
cd /opt/intelliwatt/efl-fetch-proxy
npm ci
npm run build
```

### 3) Create env file

```bash
sudo mkdir -p /etc/intelliwatt
sudo nano /etc/intelliwatt/efl-fetch-proxy.env
```

Example:

```bash
HOST=127.0.0.1
PORT=8088
EFL_FETCH_PROXY_TOKEN=your-long-random-token
EFL_FETCH_PROXY_MAX_BYTES=15728640
EFL_FETCH_PROXY_ALLOW_HOSTS=ohm-gridlink.smartgridcis.net,pp-gridlink.paylesspower.com
```

### 4) Install + start systemd unit

```bash
sudo cp /opt/intelliwatt/efl-fetch-proxy/efl-fetch-proxy.service /etc/systemd/system/efl-fetch-proxy.service
sudo systemctl daemon-reload
sudo systemctl enable efl-fetch-proxy
sudo systemctl restart efl-fetch-proxy
sudo systemctl status efl-fetch-proxy --no-pager
```

### 5) Health check

```bash
curl -sS http://127.0.0.1:8088/health
```

## Optional: nginx + TLS

If you want Vercel to call this over HTTPS on a hostname:

- Terminate TLS at nginx
- Proxy `/efl/fetch` to `http://127.0.0.1:8088/efl/fetch`
- Proxy `/health` to `http://127.0.0.1:8088/health`

Then set Vercel:

- `EFL_FETCH_PROXY_URL=https://<your-hostname>/efl/fetch`
- `EFL_FETCH_PROXY_TOKEN=<same token as droplet>`

