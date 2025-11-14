# Deploying SMT Ingest (Droplet)

This procedure installs a systemd timer on the IntelliWatt droplet that:

1. Mirrors new SMT SFTP CSV files into a local inbox.
2. Posts each unseen file **inline** to `https://<your-domain>/api/admin/smt/pull` with the admin token.

The script records posted SHA256 hashes so replays are skipped automatically.

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
ADMIN_TOKEN=REDACTED_64_CHAR
INTELLIWATT_BASE_URL=https://intelliwatt.com

SMT_HOST=ftp.smartmetertexas.biz
SMT_USER=intellipathsolutionsftp
SMT_KEY=/home/deploy/.ssh/intelliwatt_smt_rsa4096
SMT_REMOTE_DIR=/
SMT_LOCAL_DIR=/home/deploy/smt_inbox

# Optional overrides used by fetch_and_post.sh
SOURCE_TAG=adhocusage
METER_DEFAULT=M1
ESIID_DEFAULT=10443720000000001
```

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
| `deploy/smt/fetch_and_post.sh` | SFTP sync + inline POST script |
| `deploy/smt/smt-ingest.service` | systemd unit that runs the script |
| `deploy/smt/smt-ingest.timer` | systemd timer (every 30 minutes) |
| `/etc/default/intelliwatt-smt` | environment variables consumed by the unit |
| `/home/deploy/smt_ingest/web/webhook_server.py` | Python webhook bridge (droplet → Vercel trigger) |

Make the script executable:

```bash
chmod +x /home/deploy/apps/intelliwatt/deploy/smt/fetch_and_post.sh
```

---

## How deduplication works

Each successful POST writes the SHA256 of the file into `SMT_LOCAL_DIR/.posted_sha256`. To force a re-post of a particular file, remove its hash (or delete the file entirely and let the script re-run).

---

## Notes

- Admin token is injected **server-side** on the droplet; it never touches the browser/UI.
- App Router body size is not overridden, so large SMT files should be ingested here and posted inline one file at a time.
- If SFTP fails, confirm key permissions (`chmod 600`), host reachability, and username.
- Check recent runs with `journalctl -u smt-ingest.service -n 200`.
- Packages `jq`, `curl`, `openssh-client`, and coreutils tools (`sha256sum`, `base64`) must be installed.

---

## Big-File SMT Interval CSVs vs Inline Uploads

- Real SMT interval CSVs (12 months of 15-minute reads) can be large.
- The **primary ingestion path for big SMT CSVs** is:
  - SMT SFTP → droplet → `smt-ingest` script → `/api/admin/smt/pull` (inline JSON payload) → `RawSmtFile` → `SmtInterval`.
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
- → `/api/admin/smt/pull` (inline JSON payload)
- → `RawSmtFile` + `SmtInterval`

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
- Default port: `8080` (configurable via `SMT_UPLOAD_PORT`)
- Endpoint: `POST /upload` with `multipart/form-data` (field name `file`)
- Saves the file into the SMT inbox and triggers `smt-ingest.service`
- Optional shared secret header (`x-smt-upload-token`) requires `SMT_UPLOAD_TOKEN`
- Built-in rate limiting (in-memory): admins 50/day, customers 5/month by default (see env vars below)

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
Environment=SMT_UPLOAD_PORT=8080
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

Ensure the port is open (e.g., `sudo ufw allow 8080/tcp`) and set `NEXT_PUBLIC_SMT_UPLOAD_URL` (e.g., `http://<droplet-ip>:8080/upload`) so the admin UI can POST directly to this server.

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

 
