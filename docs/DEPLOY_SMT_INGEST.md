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

## Files

| Path | Purpose |
| ---- | ------- |
| `deploy/smt/fetch_and_post.sh` | SFTP sync + inline POST script |
| `deploy/smt/smt-ingest.service` | systemd unit that runs the script |
| `deploy/smt/smt-ingest.timer` | systemd timer (every 30 minutes) |
| `/etc/default/intelliwatt-smt` | environment variables consumed by the unit |

### Required environment file (`/etc/default/intelliwatt-smt`)

```bash
ADMIN_TOKEN="<64-char-admin-token>"
INTELLIWATT_BASE_URL="https://intelliwatt.com"
SMT_HOST="ftp.smartmetertexas.biz"
SMT_USER="<sftp-username>"
SMT_KEY="/home/deploy/.ssh/intelliwatt_smt_rsa4096"
SMT_REMOTE_DIR="/adhocusage"
SMT_LOCAL_DIR="/home/deploy/smt_inbox"

# Optional overrides
# SOURCE_TAG="adhocusage"
# METER_DEFAULT="M1"
```

Ensure the file is readable by `deploy` (root-owned with mode `640` is recommended).

---

## Installation steps

1. **Copy repo files (already in repo):**
   - `deploy/smt/fetch_and_post.sh`
   - `deploy/smt/smt-ingest.service`
   - `deploy/smt/smt-ingest.timer`

2. **Make the script executable**:
   ```bash
   chmod +x /home/deploy/apps/intelliwatt/deploy/smt/fetch_and_post.sh
   ```

3. **Install systemd units** (as root):
   ```bash
   sudo cp /home/deploy/apps/intelliwatt/deploy/smt/smt-ingest.service /etc/systemd/system/
   sudo cp /home/deploy/apps/intelliwatt/deploy/smt/smt-ingest.timer /etc/systemd/system/
   sudo systemctl daemon-reload
   ```

4. **Enable and start the timer**:
   ```bash
   sudo systemctl enable --now smt-ingest.timer
   ```

5. **Verify status**:
   ```bash
   systemctl status smt-ingest.timer
   journalctl -u smt-ingest.service -n 50
   ```

---

## Manual run (one-off)

To execute immediately without waiting for the timer:

```bash
sudo -u deploy INTELLIWATT_BASE_URL="https://intelliwatt.com" \
  /bin/bash /home/deploy/apps/intelliwatt/deploy/smt/fetch_and_post.sh
```

Environment variables from `/etc/default/intelliwatt-smt` are picked up automatically by systemd, but you can export overrides inline as shown.

---

## How deduplication works

Each successful POST writes the SHA256 of the file into `SMT_LOCAL_DIR/.posted_sha256`. To force a re-post of a particular file, remove its hash (or delete the file entirely and let the script re-run).

---

## Troubleshooting

- **Missing command errors**: Install the required packages (`jq`, `curl`, `openssh-client`, etc.).
- **SFTP failures**: Confirm the key path, permissions (`chmod 600` on the key), and remote directory.
- **HTTP 4xx/5xx**: Inspect the logged JSON response; verify `ADMIN_TOKEN` and that Vercel endpoint is reachable.
- **Large files**: Inline uploads rely on Vercel’s default App Router limits (~4 MB). If SMT delivers bigger payloads, switch to the droplet webhook mode or split files before posting.

---

With the timer active, the droplet continuously ingests new SMT files into IntelliWatt without exposing admin secrets in the browser.
