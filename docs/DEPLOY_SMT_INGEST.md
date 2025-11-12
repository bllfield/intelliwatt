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

# Optional overrides
SOURCE_TAG=adhocusage
METER_DEFAULT=M1
```

Ensure the file is readable by `deploy` (root-owned with mode `640` is recommended).

---

## Install systemd units

```bash
sudo cp /home/deploy/apps/intelliwatt/deploy/smt/smt-ingest.service /etc/systemd/system/
sudo cp /home/deploy/apps/intelliwatt/deploy/smt/smt-ingest.timer /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now smt-ingest.timer
sudo systemctl status smt-ingest.timer
```

This copies the units, reloads systemd, enables the timer, and shows its status.

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

With the timer active, the droplet continuously ingests new SMT files into IntelliWatt without exposing admin secrets in the client.
