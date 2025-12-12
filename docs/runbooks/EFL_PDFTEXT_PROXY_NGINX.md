# EFL `pdftotext` Helper – Droplet Nginx Proxy Runbook

## Problem

- The EFL Fact Card engine uses a `pdftotext` helper on the droplet to extract text from tricky PDFs.
- The helper listens on the droplet at `127.0.0.1:8095/efl/pdftotext` (Python + Poppler).
- Vercel **cannot** reach port `8095` directly (network/firewall), and we do **not** want to expose 8095 publicly.
- The correct pattern is:
  - Python helper listens locally on `127.0.0.1:8095`.
  - **nginx** on the droplet proxies `https://<droplet-domain>/efl/pdftotext` → `http://127.0.0.1:8095/efl/pdftotext`.
  - Vercel calls the HTTPS endpoint; the droplet never exposes 8095 to the internet.

The app expects:

- `EFL_PDFTEXT_URL` (Vercel) → `https://<droplet-domain>/efl/pdftotext`
- `EFL_PDFTEXT_TOKEN` (Vercel + droplet) → shared secret; quotes do not matter (code strips wrapping quotes).

After any **git pull on the droplet repo**, keep nginx + systemd in sync by running:

```bash
sudo bash deploy/droplet/post_pull.sh
```

This script re-applies the nginx vhost and systemd override from the repo, ensures `/home/deploy/.efl-pdftotext.env` exists (without overwriting secrets), restarts the relevant services, and runs a quick health check against `https://efl-pdftotext.intelliwatt.com/health`.

---

## 0. DNS for `efl-pdftotext.intelliwatt.com`

To expose the helper via a stable HTTPS hostname, create this DNS record with your DNS provider:

- **Type**: `A`
- **Name**: `efl-pdftotext.intelliwatt.com`
- **Value**: `64.225.25.54`  (DigitalOcean droplet IP)

Wait for DNS propagation (`nslookup efl-pdftotext.intelliwatt.com`) before running Certbot.

---

## 1. Install nginx and Certbot (droplet)

On the droplet (as `root` or `deploy` with `sudo`), ensure nginx and Certbot are installed:

```bash
sudo apt-get update
sudo apt-get install nginx certbot python3-certbot-nginx
```

---

## 2. Verify the Python helper is listening on 8095

**Where:** Droplet, as `root` (or `deploy` + `sudo`).

```bash
sudo ss -ltnp | grep 8095 || true
```

Expected output (example):

```text
tcp   LISTEN 0      5    127.0.0.1:8095      0.0.0.0:*    users:("python3",pid=...,fd=3)
```

If you do **not** see a Python process on 8095, restart the helper:

```bash
sudo systemctl restart efl-pdftotext.service
sudo systemctl status efl-pdftotext.service
```

---

## 3. Verify nginx is installed and running

```bash
sudo systemctl status nginx --no-pager
```

You should see `active (running)`. If nginx is not installed or running, follow your existing droplet nginx setup docs before continuing.

---

## 3. Option A: Attach to an existing HTTPS server block

Most droplets use `/etc/nginx/sites-enabled`.

```bash
ls -1 /etc/nginx/sites-enabled
```

Common patterns:

- `default`
- A custom site file like `intelliwatt.conf`

Open the active site (pick the correct filename from the list):

```bash
sudo nano /etc/nginx/sites-enabled/default
# or, if you have a custom file
# sudo nano /etc/nginx/sites-enabled/intelliwatt.conf
```

> **Note:** Do not remove existing `server` blocks; add a new `location` inside the existing HTTPS server block that handles `443` for your droplet domain.

---

## 4. Add the `/efl/pdftotext` proxy location

Inside the appropriate `server { ... }` block that listens on port 443 for your droplet domain, add this `location` block:

```nginx
location /efl/pdftotext {
    # Limit body size to a reasonable value for EFL PDFs (e.g. 25 MB)
    client_max_body_size 25m;

    proxy_pass http://127.0.0.1:8095/efl/pdftotext;

    # Preserve method and headers; pass through our shared token header
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;

    # Increase timeouts for slower pdf-to-text operations
    proxy_read_timeout  60s;
    proxy_connect_timeout 30s;
    proxy_send_timeout 60s;
}
```

Save and exit (`Ctrl+O`, `Enter`, `Ctrl+X`).

---

## 3b. Option B: Dedicated vhost for `efl-pdftotext.intelliwatt.com`

If you prefer a dedicated hostname for the helper, you can create a separate vhost that terminates TLS for
`efl-pdftotext.intelliwatt.com` and proxies to the local helper on `127.0.0.1:8095`.

**Where:** Droplet, as `root`.

1. Create a new site file:

```bash
sudo nano /etc/nginx/sites-available/efl-pdftotext.intelliwatt.com
```

2. Paste this minimal vhost config (adjust paths only if your Certbot layout differs):

```nginx
server {
    listen 80;
    listen [::]:80;
    server_name efl-pdftotext.intelliwatt.com;

    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl;
    listen [::]:443 ssl;
    server_name efl-pdftotext.intelliwatt.com;

    # Certbot will fill these paths; you can leave placeholders until certs are issued
    ssl_certificate     /etc/letsencrypt/live/efl-pdftotext.intelliwatt.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/efl-pdftotext.intelliwatt.com/privkey.pem;
    include /etc/letsencrypt/options-ssl-nginx.conf;
    ssl_dhparam /etc/letsencrypt/ssl-dhparams.pem;

    # EFL PDFs are small, but give a safe headroom (25 MB or higher if needed)
    client_max_body_size 25m;

    location /efl/pdftotext {
        proxy_pass http://127.0.0.1:8095/efl/pdftotext;

        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        proxy_read_timeout  60s;
        proxy_connect_timeout 30s;
        proxy_send_timeout 60s;
    }

    # Health check proxy used by curl and external monitors
    location /health {
        proxy_pass http://127.0.0.1:8095/health;

        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        proxy_read_timeout  10s;
        proxy_connect_timeout 5s;
        proxy_send_timeout 10s;
    }
}
```

3. Enable the site and test nginx:

```bash
sudo ln -s /etc/nginx/sites-available/efl-pdftotext.intelliwatt.com /etc/nginx/sites-enabled/efl-pdftotext.intelliwatt.com
sudo nginx -t
```

4. Reload nginx:

```bash
sudo systemctl reload nginx
```

5. Request/renew certificates with Certbot (if not already in place):

```bash
sudo certbot --nginx -d efl-pdftotext.intelliwatt.com
```

Certbot will update the `ssl_certificate`/`ssl_certificate_key` paths automatically in the vhost config.

---

## 5. Test and reload nginx

Always test the config before reloading:

```bash
sudo nginx -t
```

If you see `syntax is ok` and `test is successful`, reload:

```bash
sudo systemctl reload nginx
```

If there is an error, re-open the site file, fix the syntax, and re-run `sudo nginx -t` before reloading.

---

## 6. Tail Python helper logs

To see incoming requests from Vercel (or from your own curl tests):

```bash
sudo journalctl -u efl-pdftotext.service -n 200 -f
```

When the proxy is wired correctly and `EFL_PDFTEXT_URL` points at `https://<droplet-domain>/efl/pdftotext`, you should see log activity here whenever an EFL upload triggers the fallback.

---

## 7. Health check tests

### From the droplet (direct to helper)

```bash
curl -i http://127.0.0.1:8095/health
```

Expected:

- `HTTP/1.0 200 OK`
- Body: `ok`

### From anywhere (through nginx + TLS)

```bash
curl -i https://efl-pdftotext.intelliwatt.com/health
```

Expected:

- `HTTP/2 200` (or `HTTP/1.1 200` depending on curl/OpenSSL)
- Body: `ok`

If either command fails, check:

- `sudo journalctl -u efl-pdftotext.service -n 200 -f`
- `sudo journalctl -u nginx -n 200 -f`

---

## 8. Vercel environment variables

In your Vercel project settings (Production + Preview), set:

```text
EFL_PDFTEXT_URL   = https://efl-pdftotext.intelliwatt.com/efl/pdftotext
EFL_PDFTEXT_TOKEN = <your-shared-token>
```

Notes:

- The token value must **match exactly** whatever you set on the droplet, but **quotes do not matter**:
  - `EFL_PDFTEXT_TOKEN="abc123"` → normalized to `abc123`.
  - `EFL_PDFTEXT_TOKEN='abc123'`  → normalized to `abc123`.
- The app sends the token in header: `X-EFL-PDFTEXT-TOKEN: <normalized-token>`.

On the droplet, **do not** reuse the shared `/home/deploy/.intelliwatt.env` file for this helper. Instead, create a dedicated env file:

```bash
sudo nano /home/deploy/.efl-pdftotext.env
```

Example contents:

```dotenv
EFL_PDFTEXT_TOKEN=your-shared-token
EFL_PDFTEXT_PORT=8095
```

Then wire it into the systemd unit via an override so only this service reads it:

```bash
sudo systemctl edit efl-pdftotext.service
```

Paste:

```ini
[Service]
EnvironmentFile=/home/deploy/.efl-pdftotext.env
```

Reload and restart:

```bash
sudo systemctl daemon-reload
sudo systemctl restart efl-pdftotext.service
```

---

## 8. Windows curl test (PowerShell)

From your Windows machine, you can verify the proxy end-to-end using `curl.exe` (not `Invoke-WebRequest`) to avoid buffering issues with binary PDFs.

```powershell
$env:EFL_PDFTEXT_TOKEN = "<YOUR_TOKEN>"

curl.exe "https://<droplet-domain>/efl/pdftotext" `
  -H "X-EFL-PDFTEXT-TOKEN: $env:EFL_PDFTEXT_TOKEN" `
  --data-binary "@C:\Users\bllfi\Desktop\Just Energy Free Night EFL.pdf"
```

Expected:

- HTTP 200 JSON response like:

```json
{"ok":true,"text":"...first lines of EFL text..."}
```

If you get a non-200 status, check:

- `sudo journalctl -u efl-pdftotext.service -n 200 -f` for Python-side errors.
- `sudo journalctl -u nginx -n 200 -f` for proxy-level errors.

---

## 9. Firewall / network notes

- Publicly expose **only** ports 80 and 443 on the droplet.
- Port `8095` should remain reachable **only** from localhost (nginx → helper).
- Do **not** add firewall rules to expose `8095` directly to the internet; all traffic must go through HTTPS/443.

---

## 10. Do **not** open port 8095 publicly

- Keep the Python helper bound to `127.0.0.1:8095` **behind** nginx.
- Do **not** add a firewall rule exposing 8095 to the internet.
- All external traffic should go through HTTPS/443 → nginx → `http://127.0.0.1:8095/efl/pdftotext`.

---

## 11. Checklist

- [ ] Python helper (`efl-pdftotext.service`) is running and listening on 8095.
- [ ] nginx site config includes a `location /efl/pdftotext { ... }` block proxying to `http://127.0.0.1:8095/efl/pdftotext`.
- [ ] `sudo nginx -t` passes and `sudo systemctl reload nginx` has been run.
- [ ] Vercel `EFL_PDFTEXT_URL` is set to `https://<droplet-domain>/efl/pdftotext`.
- [ ] Vercel + droplet `EFL_PDFTEXT_TOKEN` match (quotes are fine; code strips them).
- [ ] Windows `curl.exe` test to `https://<droplet-domain>/efl/pdftotext` returns `{ "ok": true, "text": "..." }`.
- [ ] EFL manual-upload route shows `pdftotext` fallback as attempted and, when successful, reports `extractorMethod: "pdftotext"`.

---

## 12. Sync nginx + systemd config from repo to droplet

Once the repo contains the canonical nginx vhost, systemd override, and env example files, you can sync them to the droplet and restart the helper with a single command block.

**Where:** Droplet, as `deploy` (or `root` with `sudo`), in `/home/deploy/apps/intelliwatt`:

```bash
cd /home/deploy/apps/intelliwatt

# 1) NGINX site (from repo -> live)
sudo cp -f deploy/droplet/nginx/efl-pdftotext.intelliwatt.com /etc/nginx/sites-available/efl-pdftotext.intelliwatt.com
sudo ln -sf /etc/nginx/sites-available/efl-pdftotext.intelliwatt.com /etc/nginx/sites-enabled/efl-pdftotext.intelliwatt.com

# 2) SYSTEMD override (from repo -> live)
sudo mkdir -p /etc/systemd/system/efl-pdftotext.service.d
sudo cp -f deploy/droplet/systemd/efl-pdftotext.override.conf /etc/systemd/system/efl-pdftotext.service.d/override.conf

# 3) Ensure the EFL env file exists (do NOT overwrite if already present)
if [ ! -f /home/deploy/.efl-pdftotext.env ]; then
  sudo cp deploy/droplet/env/.efl-pdftotext.env.example /home/deploy/.efl-pdftotext.env
  sudo chown deploy:deploy /home/deploy/.efl-pdftotext.env
  sudo chmod 600 /home/deploy/.efl-pdftotext.env
fi

# 4) Reload + restart
sudo nginx -t
sudo systemctl daemon-reload
sudo systemctl reload nginx
sudo systemctl restart efl-pdftotext.service

# 5) Quick verification
sudo systemctl --no-pager status efl-pdftotext.service
curl -sS https://efl-pdftotext.intelliwatt.com/health
echo
```
