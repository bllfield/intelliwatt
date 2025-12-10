# Deploying SMT Ingest (Droplet)

This procedure installs a systemd timer on the IntelliWatt droplet that:

1. Mirrors new SMT SFTP CSV/PGP files into a local inbox.
2. Posts each unseen interval CSV to the **droplet upload server** (canonical path for large files). The upload server then chunks and forwards the content to the Vercel app via `POST /api/admin/smt/raw-upload` for storage and inline normalization.

The script records posted SHA256 hashes so replays are skipped automatically.

**Important:** For production, files must be uploaded via the droplet upload server (`SMT_UPLOAD_URL`), not inline POSTs to `/api/admin/smt/pull`. Inline POSTs are limited by Vercel's 100MB payload limit and will fail for full-year SMT CSV files.

---

## Fast restore (post-purge) to make usage pages show SMT data

Use this when intervals and raw files were cleared and you need data visible again quickly:

1. **Upload the SMT CSV to the droplet upload server (port 8081):**
   ```bash
   curl -X POST http://<droplet-host>:8081/upload \
     -F "file=@/path/to/smt.csv" \
     -F "source=smt-inline" \
     -F "esiid=YOUR_ESIID" \
     -F "meter=OPTIONAL_METER"
   ```
2. **Normalize into `SmtInterval` (app):**
   ```bash
   curl -X POST "$INTELLIWATT_BASE_URL/api/admin/smt/normalize" \
     -H "x-admin-token: $ADMIN_TOKEN" \
     -H "content-type: application/json" \
     -d '{"latest": true}'
   ```
   - If you captured `rawId` from step 1, use `{ "rawId": <id> }` instead of `latest`.
3. **Verify intervals landed:**
   ```bash
   curl -X POST "$INTELLIWATT_BASE_URL/api/admin/smt/backfill-usage" \
     -H "x-admin-token: $ADMIN_TOKEN" \
     -H "content-type: application/json" \
     -d '{"esiid":"YOUR_ESIID","days":400,"limit":100000}'
   ```
   - Expect non-empty `data` and `summary.totalKwh`.
4. **Force usage refresh (optional, if UI caches):**
   ```bash
   curl -X POST "$INTELLIWATT_BASE_URL/api/user/usage/refresh" \
     -H "content-type: application/json" \
     -d '{"houseId":"<HOUSE_ID>","esiid":"YOUR_ESIID"}'
   ```

This flow bypasses Vercel payload limits and repopulates `SmtInterval` so the usage page renders data again.

---

## Prerequisites

- Droplet user: `deploy`, project checkout at `/home/deploy/apps/intelliwatt`
- Packages (install via `apt` if missing): `jq`, `curl`, `openssh-client`
- SMT SFTP credentials: private key at `/home/deploy/.ssh/intelliwatt_smt_rsa4096`
- Same `ADMIN_TOKEN` the Vercel app uses for admin routes

---

## Required env file

Create `/etc/default/intelliwatt-smt` with the following contents (no quotes):

```bash
# Core credentials (required)
ADMIN_TOKEN=REDACTED_64_CHAR
INTELLIWATT_BASE_URL=https://intelliwatt.com

# SMT SFTP credentials (required)
SMT_HOST=ftp.smartmetertexas.biz
SMT_USER=intellipathsolutionsftp
SMT_KEY=/home/deploy/.ssh/intelliwatt_smt_rsa4096
SMT_REMOTE_DIR=/
SMT_LOCAL_DIR=/home/deploy/smt_inbox

# Droplet upload server (RECOMMENDED for production big files)
# This should point to the droplet's upload server, e.g. the smt-upload-server running on port 8081
SMT_UPLOAD_URL=http://localhost:8081/upload

# Optional overrides used by fetch_and_post.sh
SOURCE_TAG=adhocusage
METER_DEFAULT=M1
ESIID_DEFAULT=10443720000000001
SMT_UPLOAD_DELAY=2                 # seconds to sleep between uploads (throttle)
```

**Important:** 
- `SMT_UPLOAD_URL` should be set for production. The droplet upload server (smt-upload-server) listens at this URL and handles multipart file uploads without Vercel payload limits.
- If `SMT_UPLOAD_URL` is not set, the script will fall back to inline POSTs (legacy mode), which fails for large files.

Ensure the file is readable by `deploy` (root-owned with mode `640` is recommended).

---

## Install systemd units

```bash
sudo cp /home/deploy/apps/intelliwatt/deploy/smt/smt-ingest.service /etc/systemd/system/
sudo cp /home/deploy/apps/intelliwatt/deploy/smt/smt-ingest.timer /etc/systemd/system/
sudo systemctl daemon-reload
```

### Ensure the service has a writable working directory

```bash
sudo mkdir -p /etc/systemd/system/smt-ingest.service.d
sudo tee /etc/systemd/system/smt-ingest.service.d/override.conf >/dev/null <<'OVR'
[Service]
WorkingDirectory=/home/deploy/smt_inbox
Environment=STATE_FILE=/home/deploy/smt_inbox/.posted_sha256
OVR
sudo systemctl daemon-reload
sudo systemctl enable --now smt-ingest.timer
sudo systemctl status smt-ingest.timer
```

---

## Manual run (on-demand)

To run immediately and tail logs:

```bash
sudo systemctl start smt-ingest.service
journalctl -u smt-ingest.service -n 200 -f
```

You can also run the script directly as the `deploy` user if you need to override environment variables temporarily:

```bash
sudo -u deploy INTELLIWATT_BASE_URL="https://intelliwatt.com" \
  /bin/bash /home/deploy/apps/intelliwatt/deploy/smt/fetch_and_post.sh
```

---

## Files installed

| Path | Purpose |
| ---- | ------- |
| `deploy/smt/fetch_and_post.sh` | SFTP sync + droplet upload POST script |
| `deploy/smt/smt-ingest.service` | systemd unit that runs the script |
| `deploy/smt/smt-ingest.timer` | systemd timer (every 30 minutes) |
| `/etc/default/intelliwatt-smt` | environment variables consumed by the unit |

Make the script executable:

```bash
chmod +x /home/deploy/apps/intelliwatt/deploy/smt/fetch_and_post.sh
```

---

## How it works

1. **fetch_and_post.sh** runs on schedule (via smt-ingest.timer, every 30 minutes).
2. It SFTP-fetches new CSV and PGP `.asc` bundles from SMT into `/home/deploy/smt_inbox`.
3. For each unseen interval CSV, it POSTs to **SMT_UPLOAD_URL** (the droplet upload server) using multipart/form-data, sleeping `SMT_UPLOAD_DELAY` seconds between uploads to keep load modest. Queue endpoints have been removed; processing is purely sequential.
4. The droplet upload server receives the file, materializes the relevant `IntervalMeterUsage*.csv` when necessary, splits large CSVs into small chunks, and forwards them to `POST /api/admin/smt/raw-upload` in the Vercel app. That route persists `RawSmtFile` rows and normalizes intervals into `SmtInterval` inline for the supplied `esiid`/`meter`.
5. Deduplication: SHA256 hashes of posted files are recorded in `.posted_sha256` to prevent replays.

**Why droplet upload server instead of inline POSTs?**
- Inline POSTs encode the file as base64+gzip and POST JSON to Vercel, but Vercel's App Router has a ~100MB payload limit.
- Full-year SMT interval CSVs (12 months of 15-minute reads) exceed this limit.
- The droplet upload server speaks multipart/form-data directly, bypassing the Vercel limit.

---

## How deduplication works

Each successful POST writes the SHA256 of the file into `SMT_LOCAL_DIR/.posted_sha256`. To force a re-post of a particular file, remove its hash (or delete the file entirely and let the script re-run).

---

## Notes

- The droplet upload server (`smt-upload-server.ts`) must be running and accessible at `SMT_UPLOAD_URL`.
- If `SMT_UPLOAD_URL` is not set, the script will warn and fall back to legacy inline POSTs (not recommended).
- If SFTP fails, confirm key permissions (`chmod 600`), host reachability, and username.
- Check recent runs with `journalctl -u smt-ingest.service -n 200`.
- Packages `jq`, `curl`, `openssh-client`, and coreutils tools (`sha256sum`, `base64`) must be installed.

---

## Big-File SMT Interval CSVs vs Inline Uploads

- Real SMT interval CSVs (12 months of 15-minute reads) can be large.
- The **primary ingestion path for big SMT CSVs** is:
  - SMT SFTP → droplet → `fetch_and_post.sh` → **droplet upload server** (multipart/form-data) → `RawSmtFile` → `SmtInterval`.
  - **This avoids Vercel's 100MB payload limit** by not posting inline to `/api/admin/smt/pull`.
- The `/admin/smt/raw` → “Load Raw Files” inline upload:
  - Is limited by Vercel App Router’s request body size (~4 MB).
  - Is intended for **small test files and debugging**, not for production 12-month SMT exports.
- Admin or customer “manual interval uploads” must use a big-file-safe path (droplet, storage-based, or equivalent) rather than relying solely on the small inline upload.
  - Future customer-facing manual upload flows should reuse the droplet ingest pipeline or another storage-backed approach that avoids App Router limits.

### Admin automation: `Upload-SmtCsvToDroplet.ps1`

- For ad-hoc big SMT CSV uploads (admin/testing), use the PowerShell helper committed to the repo:
  - Script: `scripts/admin/Upload-SmtCsvToDroplet.ps1`
  - Example (PowerShell on your workstation):
    ```powershell
    .\scripts\admin\Upload-SmtCsvToDroplet.ps1 `
      -FilePath "C:\data\smt_full_year.csv" `
      -DropletHost "64.225.25.54"
    ```
  - Requirements:
    - SSH key-based access for the target droplet user (defaults to `deploy`).
    - `scp` and `ssh` available in your PowerShell environment (Git for Windows or OpenSSH).
- What the script does:
  1. Copies the local CSV into the droplet inbox (`/home/deploy/smt_inbox` by default).
  2. Starts `smt-ingest.service`, which posts the file through `/api/admin/smt/pull` (mode `"inline"`) so it lands in `RawSmtFile` and `SmtInterval`.
- After running the script:
  - Wait briefly, then visit `/admin/smt/raw` to confirm a new `RawSmtFile`.
  - Use SMT admin tools to inspect or normalize as needed.

### Manual Big-File SMT CSV Ingest (Admin Script)

For full-size SMT interval CSVs (e.g., 12 months of 15-minute data), the canonical ingestion path is:

- Local file (admin machine)
- → Droplet SMT inbox (`/home/deploy/smt_inbox`)
- → `smt-ingest.service` (runs the ingest script)
- → droplet HTTP upload server (`SMT_UPLOAD_URL`, multipart `/upload`)
- → `POST /api/admin/smt/raw-upload` (chunked CSV parts)
- → `RawSmtFile` + `SmtInterval` (inline normalization per chunk)

To make this repeatable, we provide an admin PowerShell helper script in the repo:

- `scripts/admin/Upload-SmtCsvToDroplet.ps1`

Usage example (from Windows PowerShell, with SSH/scp configured):

```powershell
cd path\to\intelliwatt\repo

.\scripts\admin\Upload-SmtCsvToDroplet.ps1 `
  -FilePath "C:\path\to\intervaldata.csv" `
  -DropletHost "your_droplet_host_or_ip"
```

After the script returns:

1. Wait a short moment for `smt-ingest.service` to finish processing.
2. Visit `/admin/smt/raw` to confirm a new `RawSmtFile` row.
3. Normalize/inspect via the SMT admin tools as needed.

### Droplet HTTP Upload Server (`smt-upload-server`)

For web-based big-file uploads (admin UI today, customer UI later) we run a lightweight HTTP server on the droplet:

- Source: `scripts/droplet/smt-upload-server.ts`
- Default port: `8081` (configurable via `SMT_UPLOAD_PORT`)
- Endpoint: `POST /upload` with `multipart/form-data` (field name `file`)
- Saves the file into the SMT inbox and triggers `smt-ingest.service`
- Optional shared secret header (`x-smt-upload-token`) requires `SMT_UPLOAD_TOKEN`
- Built-in rate limiting (in-memory): admins 50/day, customers 5/month by default (see env vars below)
- Used by `/admin/smt/raw` and customer page `app/customer/smt-upload/page.tsx`

#### Install / run manually

```bash
cd /home/deploy/apps/intelliwatt
npm install --production # installs express, multer, etc.
npx ts-node --transpile-only scripts/droplet/smt-upload-server.ts
```

#### Systemd unit (recommended)

Create `/etc/systemd/system/smt-upload-server.service`:

```
[Unit]
Description=IntelliWatt SMT upload server
After=network.target

[Service]
Type=simple
User=deploy
WorkingDirectory=/home/deploy/apps/intelliwatt
Environment=SMT_UPLOAD_PORT=8081
Environment=SMT_LOCAL_DIR=/home/deploy/smt_inbox
Environment=SMT_INGEST_SERVICE_NAME=smt-ingest.service
ExecStart=/usr/bin/npx ts-node --transpile-only scripts/droplet/smt-upload-server.ts
Restart=on-failure

[Install]
WantedBy=multi-user.target
```

Then reload + enable:

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now smt-upload-server.service
sudo systemctl status smt-upload-server.service
```

Ensure the port is open (e.g., `sudo ufw allow 8081/tcp`) and set `NEXT_PUBLIC_SMT_UPLOAD_URL` (e.g., `https://smt-upload.intelliwatt.com/upload`) so the admin UI can POST directly to this server.

### Daily Billing (DailyMeterUsage) Decrypt & Ingest

- SMT delivers **DailyMeterUsage** billing extracts as PGP-armored ZIPs (e.g., `DailyMeterUsageYYYYMMDDHHMMSS…CSV.134642921.asc`).
- `deploy/smt/fetch_and_post.sh` now:
  - Decrypts `.asc` files with `gpg` using the IntelliWatt SMT keypair.
  - Unzips the decrypted payload to a temporary CSV under `$SMT_LOCAL_DIR`.
  - Either posts that CSV inline to `POST /api/admin/smt/pull` (mode `inline`) or hands it to the droplet upload server, depending on configuration.
- The admin APIs detect DailyMeterUsage CSVs and persist both `RawSmtFile` and `SmtBillingRead` rows automatically.
- Requirements:
  - `gpg` and `unzip` installed on the droplet.
  - IntelliWatt SMT GPG keypair available for the `deploy` user (`/home/deploy/.gnupg`).
- Interval files (`IntervalMeterUsage*.csv`) are preferred when decrypting multi-file bundles and continue through the interval ingest pipeline described above.

### SMT Upload HTTPS Proxy (`smt-upload.intelliwatt.com`)

- The SMT upload server now runs as a Node process on the droplet:
  - `node scripts/droplet/smt-upload-server.js`
  - Binds to `127.0.0.1:8081` by default with environment:
    - `SMT_UPLOAD_DIR=/home/deploy/smt_inbox`
    - `SMT_UPLOAD_PORT=8081`
    - `SMT_UPLOAD_MAX_BYTES=10485760`
    - `SMT_INGEST_SERVICE_NAME=smt-ingest.service`
    - (optional) `SMT_UPLOAD_TOKEN=<shared-secret>`
- nginx terminates TLS for `smt-upload.intelliwatt.com` and proxies to the local Node server:

```
server {
  listen 443 ssl;
  server_name smt-upload.intelliwatt.com;
  ssl_certificate /etc/letsencrypt/live/smt-upload.intelliwatt.com/fullchain.pem;
  ssl_certificate_key /etc/letsencrypt/live/smt-upload.intelliwatt.com/privkey.pem;
  include /etc/letsencrypt/options-ssl-nginx.conf;
  ssl_dhparam /etc/letsencrypt/ssl-dhparams.pem;
  location / {
    client_max_body_size 10m;
    proxy_pass http://127.0.0.1:8081;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
  }
}
server {
  listen 80;
  server_name smt-upload.intelliwatt.com;
  client_max_body_size 10m;
  if ($host = smt-upload.intelliwatt.com) {
    return 301 https://$host$request_uri;
  }
  return 404;
}
```

- nginx explicitly sets `client_max_body_size 10m` inside the HTTPS `location /` block to eliminate the 413 errors Brian hit when the default 1 MB limit rejected 12-month SMT CSVs (~5.4 MB).
- Certbot manages the certificate and the 80 → 443 redirect; renewals update the files referenced above automatically.
- The upload server health endpoint is exposed at `https://smt-upload.intelliwatt.com/health` and returns JSON `{ ok, service, uploadDir, maxBytes }`.
- This droplet upload endpoint is now the canonical path for full-size SMT manual uploads (admin and customer). The App Router inline upload remains a debug-only path for small files.

---

## Quick: SSH to droplet as deploy

- Already root on the box? Switch back to `deploy` and the repo:
  ```bash
  sudo -iu deploy
  cd /home/deploy/apps/intelliwatt
  ```
- From a fresh local terminal:
  ```bash
  ssh deploy@<DROPLET_IP_OR_HOSTNAME>
  cd /home/deploy/apps/intelliwatt
  ```

---

## Webhook (droplet → Vercel bridge)

- Webhook server path: `/home/deploy/smt_ingest/web/webhook_server.py`
- External URL used by Vercel: `DROPLET_WEBHOOK_URL=http://64.225.25.54:8787/trigger/smt-now`
- Accepted header names (Vercel route will match any): `x-intelliwatt-secret`, `x-smt-secret`, `x-webhook-secret`
- Secret env var (set on Vercel and droplet): `INTELLIWATT_WEBHOOK_SECRET` (alias `DROPLET_WEBHOOK_SECRET`)

---

## Manual inline post (bash)

```bash
BASE_URL="https://intelliwatt.com"
ADMIN_TOKEN="<64-char-token>"
CSV="/home/deploy/smt_inbox/seed_root.csv"
ESIID="10443720000000001"
METER="M1"

json=$(jq -n \
  --arg mode "inline" \
  --arg source "adhocusage" \
  --arg filename "$(basename "$CSV")" \
  --arg mime "text/csv" \
  --arg encoding "base64" \
  --arg content_b64 "$(base64 -w 0 "$CSV")" \
  --arg esiid "$ESIID" \
  --arg meter "$METER" \
  --arg captured_at "$(date -u +"%Y-%m-%dT%H:%M:%SZ")" \
  --argjson sizeBytes "$(stat -c %s "$CSV")" \
  '{mode,source,filename,mime,encoding,sizeBytes,content_b64,esiid,meter,captured_at}'
)

printf '%s' "$json" | curl -sS -o - -w '\nHTTP %{http_code}\n' \
  -X POST "$BASE_URL/api/admin/smt/pull" \
  -H "x-admin-token: $ADMIN_TOKEN" \
  -H "content-type: application/json" \
  --data-binary @-
```

---

## Manual inline post (PowerShell)

```powershell
pwsh -File scripts/admin/smt_inline_post_test.ps1 `
  -BaseUrl https://intelliwatt.com `
  -AdminToken <token> `
  -CsvPath /home/deploy/smt_inbox/seed_root.csv `
  -Esiid 10443720000000001 `
  -Meter M1
```

---

With the timer active, the droplet continuously ingests new SMT files into IntelliWatt without exposing admin secrets in the client.

### Droplet Script Sync Workflow (Git → Droplet)

Source of truth for SMT ingest scripts now lives in the repo:

- `deploy/smt/fetch_and_post.sh`
- `deploy/droplet/webhook_server.py`
- `deploy/droplet/run_webhook.sh`
- `deploy/droplet/smt_token_test.sh`

Standard workflow:

1. Make changes in Cursor to the files above and commit to the main branch.
2. On Windows (PowerShell), run from the repo root (`intelliwatt-clean`) to push the updated file:

   ```powershell
   scp.exe -i "$env:USERPROFILE\.ssh\intelliwatt_win_ed25519" ".\deploy\droplet\webhook_server.py" root@64.225.25.54:/home/deploy/webhook_server.py
   ```

   Use the same pattern for other scripts by changing only the local path and the remote destination.

3. On the droplet, restart the relevant services (if needed):

   ```bash
   sudo systemctl restart smt-webhook.service
   sudo systemctl restart smt-ingest.service
   ```

4. Tail logs to confirm the updates:

   ```bash
   journalctl -u smt-webhook.service -n 50 -f
   journalctl -u smt-ingest.service -n 50 -f
   ```

Notes:

- SMT env for ingest remains in `/etc/default/intelliwatt-smt` (ADMIN_TOKEN, INTELLIWATT_BASE_URL, SMT_HOST, SMT_USER, SMT_KEY, SMT_REMOTE_DIR, SMT_LOCAL_DIR, etc.).
- SMT SFTP is the only supported channel for usage/billing files; Vercel must not call SMT directly.
- Behavior changes start in Git (Cursor edits) and then deploy to the droplet; avoid ad-hoc edits in `/home/deploy/smt_ingest/web`.

[2025-11-12] Verified droplet + systemd + webhook configuration

Droplet (Ubuntu 25.04), user: deploy

- Inbox: `/home/deploy/smt_inbox` (mkdir -p; `sudo chown -R deploy:deploy /home/deploy/smt_inbox`)

- Webhook server: `/home/deploy/smt_ingest/web/webhook_server.py`

- Port: 8787 (open in UFW: `sudo ufw allow 8787/tcp`; confirm: `ss -ltnp | grep 8787`)

- Process: `ps -fp <pid>` should show `python3 .../webhook_server.py`

Systemd unit + override (installed via repo assets):

- Unit files copied from repo:

  - `/etc/systemd/system/smt-ingest.service`  ← source: `deploy/smt/smt-ingest.service`

  - `/etc/systemd/system/smt-ingest.timer`    ← source: `deploy/smt/smt-ingest.timer`

- Override to force writable working dir + state file:

  - mkdir: `/etc/systemd/system/smt-ingest.service.d`

  - file: `/etc/systemd/system/smt-ingest.service.d/override.conf`

    ```

    [Service]

    WorkingDirectory=/home/deploy/smt_inbox

    Environment=STATE_FILE=/home/deploy/smt_inbox/.posted_sha256

    ```

- Reload + enable:

  - `sudo systemctl daemon-reload`

  - `sudo systemctl enable --now smt-ingest.timer`

  - `journalctl -u smt-ingest.service -n 100 --no-pager`

Droplet Env file:

- `/etc/default/intelliwatt-smt`

  - must include: `ADMIN_TOKEN`, `INTELLIWATT_BASE_URL`, `SMT_HOST`, `SMT_USER`, `SMT_KEY`, `SMT_REMOTE_DIR`, `SMT_LOCAL_DIR`

  - optional: `SOURCE_TAG`, `METER_DEFAULT`, `ESIID_DEFAULT`

SMT Upload & Ingest: Current Deployment Checklist (2025-11-15)

This section reflects the currently working SMT ingestion flow and overrides older partial notes.

Droplet services

smt-upload-server.service

Node server at scripts/droplet/smt-upload-server.js.

Listens on 127.0.0.1:8081.

Proxied via nginx as https://smt-upload.intelliwatt.com.

Endpoints:

GET /health — smoke check.

POST /upload — accepts SMT CSV uploads (multipart).

smt-ingest.service

Runs deploy/smt/fetch_and_post.sh.

Responsibilities:

SFTP mirror from Smart Meter Texas to /home/deploy/smt_inbox.

Iterate .csv files and dedupe by SHA-256 (.posted_sha256).

Build inline JSON payloads via embedded python3:

Gzip + base64 encode contents.

Post to https://intelliwatt.com/api/admin/smt/pull with x-admin-token.

Verify after deployment

On the droplet:

```
# Check upload server
curl -sS https://smt-upload.intelliwatt.com/health | jq

# Trigger ingest manually
sudo systemctl restart smt-ingest.service
journalctl -u smt-ingest.service -n 80 --no-pager
```

You should see logs like:

```
Starting SFTP sync from intellipathsolutionsftp@ftp.smartmetertexas.biz:/

Posting inline payload: 20251114T202822_IntervalData.csv → https://intelliwatt.com/api/admin/smt/pull (esiid=..., meter=..., size=...)

POST success (200): {"ok":true,...,"encoding":"base64+gzip",...,"message":"Inline payload stored and verified."}
```

Admin verification endpoints

On the droplet (or any trusted machine with ADMIN_TOKEN):

```
# Latest raw SMT files
curl -sS -H "x-admin-token: $ADMIN_TOKEN" \
  "https://intelliwatt.com/api/admin/debug/smt/raw-files?limit=10" | jq

# Daily summary for a known ESIID/meter
curl -sS -H "x-admin-token: $ADMIN_TOKEN" \
  "https://intelliwatt.com/api/admin/analysis/daily-summary?esiid=10443720000000001&meter=M1&dateStart=2025-11-14T00:00:00Z&dateEnd=2025-11-16T00:00:00Z&limit=10" | jq
```

A working ingest flow will show:

The IntervalData CSVs in raw-files (e.g. 20251114T202822_IntervalData.csv).

Corresponding SmtInterval entries for that ESIID/meter in daily-summary.

## SMT Inline Normalize + Verification (Admin Flow)

This documents the current manual admin flow we used to verify SMT ingest for ESIID `10443720004529147`. Use placeholders for real secrets in docs.

### 1. Normalize a specific Raw SMT file

From any terminal with access to production:

```bash
export ADMIN_TOKEN="<ADMIN_TOKEN>"

curl -sS -X POST "https://intelliwatt.com/api/admin/smt/normalize" \
  -H "x-admin-token: $ADMIN_TOKEN" \
  -H "content-type: application/json" \
  --data-binary '{"rawId":"<RAW_SMT_FILE_ID>"}'
```

Example (test file):

- `rawId = "10"`

Response (shape):

```jsonc
{
  "ok": true,
  "dryRun": false,
  "filesProcessed": 5,
  "intervalsInserted": 96,
  "duplicatesSkipped": 189,
  "totalKwh": 69.699,
  "tsMin": "2025-01-01T06:00:00.000Z",
  "tsMax": "2025-11-18T05:30:00.000Z",
  "files": [
    {
      "id": "10",
      "filename": "20251114T202822_IntervalData.csv",
      "records": 96,
      "inserted": 96,
      "skipped": 0,
      "kwh": 31.669,
      "tsMin": "2025-11-17T05:45:00.000Z",
      "tsMax": "2025-11-18T05:30:00.000Z"
    }
    // other older test files will typically show inserted: 0, skipped: N
  ]
}
```

Key points:

- First run inserts new intervals.
- Subsequent runs on the same `rawId` should show `inserted: 0`, `skipped: <records>` due to `skipDuplicates: true`.

### 2. Inspect SmtInterval rows for an ESIID

```bash
export ADMIN_TOKEN="<ADMIN_TOKEN>"

# Quick peek at latest 5 intervals
curl -sS -H "x-admin-token: $ADMIN_TOKEN" \
  "https://intelliwatt.com/api/admin/debug/smt/intervals?esiid=<ESIID>&limit=5"

# Bounded window in UTC (ISO 8601)
curl -sS -H "x-admin-token: $ADMIN_TOKEN" \
  "https://intelliwatt.com/api/admin/debug/smt/intervals?esiid=<ESIID>&dateStart=2025-11-17T00:00:00Z&dateEnd=2025-11-19T00:00:00Z&limit=200"
```

What to check:

- `esiid` matches the expected ESIID.
- `meter` is currently `"unknown"` (we’ll add proper meter IDs later).
- `kwh` values look realistic (0s overnight, higher values during peak usage).
- `ts` is in UTC, but lines up with the local America/Chicago day when converted.

### 3. Delete bad test intervals for an ESIID (if needed)

If a test load used a mangled ESIID or wrong mapping, delete that slice before re-normalizing:

```bash
export ADMIN_TOKEN="<ADMIN_TOKEN>"

curl -sS -X POST "https://intelliwatt.com/api/admin/debug/smt/intervals" \
  -H "x-admin-token: $ADMIN_TOKEN" \
  -H "content-type: application/json" \
  --data-binary '{
    "esiid": "<ESIID>",
    "meter": "unknown",
    "dateStart": "2025-11-15T00:00:00Z",
    "dateEnd":   "2025-11-17T00:00:00Z"
  }'
```

The response will show `deletedCount`, which should match the number of rows being removed.

### 4. Daily rollup sanity via /analysis/daily-summary

```bash
export ADMIN_TOKEN="<ADMIN_TOKEN>"

curl -sS -H "x-admin-token: $ADMIN_TOKEN" \
  "https://intelliwatt.com/api/admin/analysis/daily-summary?esiid=<ESIID>&dateStart=2025-11-17T00:00:00Z&dateEnd=2025-11-19T00:00:00Z&limit=10"
```

Current behavior:

- `expected: 96` → FULL 15-minute day.
- `found` = count of intervals in that local day’s window.
- `completeness = found / expected`.
- Partial CSV windows (like 2025-11-17T05:45Z → 2025-11-18T05:30Z) will show completeness around 0.5 across two adjacent dates, which is expected.

This is primarily an admin diagnostic right now and will evolve as we tighten DST and boundary handling.
 
## SMT Token Proxy (JWT) — `smt-token-proxy.service`

Purpose: expose a droplet-based HTTP endpoint that fetches SMT JWT tokens using the whitelisted droplet IP, so IntelliWatt backends/tools do not call SMT directly from Vercel.

- **Env file:** `/etc/default/smt-token-proxy`
- **Script:** `/home/deploy/smt-token-proxy.js`
- **Systemd unit:** `/etc/systemd/system/smt-token-proxy.service`

Example `/etc/default/smt-token-proxy`:

```ini
SMT_API_BASE_URL="https://services.smartmetertexas.net"
SMT_USERNAME="INTELLIPATH"
SMT_PASSWORD="********"
SMT_PROXY_TOKEN="ChangeThisToAStrongSharedSecret_1763428355"
SMT_PROXY_PORT="4101"
```

Systemd unit:

```ini
[Unit]
Description=IntelliWatt SMT Token Proxy
After=network.target

[Service]
Type=simple
User=deploy
WorkingDirectory=/home/deploy
EnvironmentFile=/etc/default/smt-token-proxy
ExecStart=/usr/bin/node /home/deploy/smt-token-proxy.js
Restart=on-failure
RestartSec=5s
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
```

Lifecycle:

```bash
sudo systemctl daemon-reload
sudo systemctl enable smt-token-proxy.service
sudo systemctl restart smt-token-proxy.service
sudo systemctl status smt-token-proxy.service --no-pager
```

Smoke test (run on droplet):

```bash
source /etc/default/smt-token-proxy
curl -i -X POST "http://127.0.0.1:${SMT_PROXY_PORT}/admin/smt/token" \
  -H "x-proxy-token: ${SMT_PROXY_TOKEN}"
```

Expected output:

- HTTP/1.1 200 OK
- JSON payload containing:
  - `ok: true`
  - `via: "smt-token-proxy"`
  - `smtStatusCode: 200`
  - `smtBody.statusCode: 200`
  - `smtBody.accessToken: "<JWT>..."`

If the response shows `invalidCredentials`, verify the SMT username/password and that the droplet IP remains whitelisted with SMT.


---

## SMT Cron & Droplet Ingest (Production Wiring)

This section documents the production SMT ingest wiring now running on the `intelliwatt-smt-proxy` droplet. It corresponds to Plan Change `[PC-2025-11-17-D] SMT Cron + Droplet Ingest Wired (Production Path)`.

### 1. Droplet Environment File

Create or update `/etc/default/intelliwatt-smt` (as root):

```bash
cat >/etc/default/intelliwatt-smt <<'EOF'
# IntelliWatt SMT ingest env (used by deploy/smt/fetch_and_post.sh via smt-ingest.service)

# Admin token for calling /api/admin routes (header: x-admin-token)
ADMIN_TOKEN=<ADMIN_TOKEN>

# Base URL of the production IntelliWatt app (Vercel)
INTELLIWATT_BASE_URL=https://intelliwatt.com

# SMT SFTP connection (from Smart Meter Texas portal)
SMT_HOST=ftp.smartmetertexas.biz
SMT_USER=intellipathsolutionsftp
SMT_KEY=/home/deploy/.ssh/intelliwatt_smt_rsa4096
SMT_REMOTE_DIR=/
SMT_LOCAL_DIR=/home/deploy/smt_inbox

# Optional overrides consumed by deploy/smt/fetch_and_post.sh
# Source tag should stay "adhocusage" to match normalize + analysis logic.
SOURCE_TAG=adhocusage
METER_DEFAULT=unknown
EOF
```

> NOTE: Replace `<ADMIN_TOKEN>` with the actual 64-character admin token. Do **not** commit this file to git; it lives only on the droplet.

### 2. Systemd Units

Install / refresh the units (idempotent):

```bash
cp /home/deploy/apps/intelliwatt/deploy/smt/smt-ingest.service /etc/systemd/system/smt-ingest.service
cp /home/deploy/apps/intelliwatt/deploy/smt/smt-ingest.timer   /etc/systemd/system/smt-ingest.timer
```

Create an override to wire in the env + working directory:

```bash
mkdir -p /etc/systemd/system/smt-ingest.service.d
cat >/etc/systemd/system/smt-ingest.service.d/override.conf <<'EOF'
[Service]
EnvironmentFile=/etc/default/intelliwatt-smt
WorkingDirectory=/home/deploy/apps/intelliwatt
EOF

systemctl daemon-reload
systemctl enable smt-ingest.timer
systemctl start smt-ingest.timer
```

### 3. Verifying the Cron / Ingest Pipeline

Check the timer:

```bash
systemctl status smt-ingest.timer --no-pager
```

You should see:

```
Loaded: loaded (/etc/systemd/system/smt-ingest.timer; enabled; …)
Active: active (waiting)
```

Check recent ingest runs:

```bash
journalctl -u smt-ingest.service -n 50 --no-pager
```

Example healthy output:

```
Starting SFTP sync from intellipathsolutionsftp@ftp.smartmetertexas.biz:/
Fetching /adhocusage/ to adhocusage
Skipping already-posted file: /home/deploy/smt_inbox/20251114T202822_IntervalData.csv
Ingest run complete
smt-ingest.service: Deactivated successfully.
```

### 4. End-to-End Flow (Expected Behavior)

Every ~30 minutes, `smt-ingest.timer` fires `smt-ingest.service`.

`deploy/smt/fetch_and_post.sh`:

- Runs `sftp` against `SMT_HOST` and syncs all files under `SMT_REMOTE_DIR` into `SMT_LOCAL_DIR` (including `/adhocusage` and `/EnrollmentReports`).
- For each new CSV file in `SMT_LOCAL_DIR` that has not been posted yet:
  - Posts it inline to the IntelliWatt admin upload endpoint.

The admin upload handler:

- Persists a `RawSmtFile` row.
- Invokes `normalizeInlineSmtCsv` to parse the CSV, convert CST/CDT → UTC, and `createMany` `SmtInterval` rows with `skipDuplicates: true`, `source="adhocusage"`, `meter="unknown"`, and a cleaned `esiid`.
- Subsequent runs log “Skipping already-posted file: …” for files that were already pushed, ensuring idempotent ingestion.

At this point, SMT ingest + normalize is fully wired:

```
SMT SFTP → droplet (/home/deploy/smt_inbox) → inline POST → RawSmtFile → SmtInterval
```

Admins can:

- Inspect intervals via `/api/admin/debug/smt/intervals`.
- Run `/api/admin/analysis/daily-summary` to check daily completeness.
- Use the SMT admin tools UI:
  - `/admin/smt/raw` (includes “Normalize Latest SMT File” control).
  - `/admin/smt/normalize`.
  - `/admin/smt/trigger`.

## On-demand SMT ingest from SMT authorizations

The droplet now supports an auth-triggered ingest path that complements the timer-based job.

### Services involved

- `smt-ingest.service`
  - Timer-driven ingest (see units above) that calls `deploy/smt/fetch_and_post.sh` on a schedule.
  - Reads `/etc/default/intelliwatt-smt` for SMT_* and IntelliWatt env variables.
- `smt-webhook.service`
  - Listens on port 8787 for on-demand ingest triggers at `POST /trigger/smt-now`.
  - `ExecStart=/home/deploy/smt_ingest/web/run_webhook.sh`.
  - Drop-in override adds:
    ```ini
    [Service]
    EnvironmentFile=/home/deploy/smt_ingest/.env
    EnvironmentFile=/etc/default/intelliwatt-smt
    ```

### Webhook behavior (`webhook_server.py`)

- Accepts only `POST /trigger/smt-now`.
- Validates one of the shared-secret headers:
  - `x-intelliwatt-secret`
  - `x-droplet-webhook-secret`
  - `x-proxy-secret`
- Parses JSON payload and inspects `reason`:
  - Unrecognized `reason` ⇒ log generic trigger and exit (legacy behavior).
  - `reason == "smt_authorized"` ⇒ log payload and execute:
    ```bash
    cd /home/deploy/apps/intelliwatt && \
    ESIID_DEFAULT=<payload.esiid> \
    deploy/smt/fetch_and_post.sh
    ```

### `fetch_and_post.sh` recap

- Requires: `SMT_HOST`, `SMT_USER`, `SMT_KEY`, `SMT_REMOTE_DIR`, `SMT_LOCAL_DIR`, `INTELLIWATT_BASE_URL`, `ADMIN_TOKEN` (plus `SMT_UPLOAD_URL` for the droplet upload server path).
- Runs `lftp mget -p -r *` from `SMT_REMOTE_DIR` into `SMT_LOCAL_DIR`.
- Scans for `*.csv` (depth ≤ 2) and decrypted `IntervalMeterUsage*.csv` from PGP bundles.
- For each CSV:
  - Computes SHA-256 and skips files already recorded in `.posted_sha256`.
  - Uses `ESIID_DEFAULT` (from the webhook payload or env) as the trusted ESIID for every file in the ingest batch instead of attempting to parse ESIID from filenames or CSV content. If `ESIID_DEFAULT` is missing, the script logs a warning and skips the file.
  - Applies `METER_DEFAULT` or a simple meter guess where needed.
  - POSTs the file to `${SMT_UPLOAD_URL}` (droplet upload server) as multipart form data. The upload server then chunks and forwards the CSV to `POST /api/admin/smt/raw-upload`, which both stores `RawSmtFile` and normalizes into `SmtInterval` for that ESIID.

### Ops: How to test the flow

1. On droplet (as `deploy`):
   ```bash
   sudo journalctl -u smt-webhook.service -n 40 -f
   ```
2. In browser: visit `/dashboard/api#smt`, submit SMT authorization.
3. Observe droplet logs:
   ```
   [INFO] SMT authorization webhook received: reason='smt_authorized' ...
   [INFO] Starting SMT ingest via: cd /home/deploy/apps/intelliwatt && ESIID_DEFAULT=... deploy/smt/fetch_and_post.sh
   [INFO] SMT ingest finished for ESIID='...' rc=0 ...
   ```
4. Confirm new CSVs in `/home/deploy/smt_inbox` and check `/api/admin/smt/raw` or interval admin views.