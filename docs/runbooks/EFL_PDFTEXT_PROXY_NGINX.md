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

---

## 1. Verify the Python helper is listening on 8095

**Where:** Droplet, as `root` (or `deploy` + `sudo`).

```bash
sudo ss -ltnp | grep 8095 || true
```

Expected output (example):

```text
tcp   LISTEN 0      5    0.0.0.0:8095      0.0.0.0:*    users:("python3",pid=...,fd=3)
```

If you do **not** see a Python process on 8095, restart the helper:

```bash
sudo systemctl restart efl-pdftotext.service
sudo systemctl status efl-pdftotext.service
```

---

## 2. Verify nginx is installed and running

```bash
sudo systemctl status nginx --no-pager
```

You should see `active (running)`. If nginx is not installed or running, follow your existing droplet nginx setup docs before continuing.

---

## 3. Find the active nginx site config

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

## 7. Vercel environment variables

In your Vercel project settings (Production + Preview), set:

```text
EFL_PDFTEXT_URL   = https://<droplet-domain>/efl/pdftotext
EFL_PDFTEXT_TOKEN = <your-shared-token>
```

Notes:

- The token value must **match exactly** whatever you set on the droplet (e.g. in `/home/deploy/.intelliwatt.env`), but **quotes do not matter**:
  - `EFL_PDFTEXT_TOKEN="abc123"` → normalized to `abc123`.
  - `EFL_PDFTEXT_TOKEN='abc123'`  → normalized to `abc123`.
- The app sends the token in header: `X-EFL-PDFTEXT-TOKEN: <normalized-token>`.

On the droplet, ensure `EFL_PDFTEXT_TOKEN` is set in the environment used by `efl-pdftotext.service` (e.g. `/home/deploy/.intelliwatt.env`).

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

## 9. Do **not** open port 8095 publicly

- Keep the Python helper bound to `127.0.0.1:8095` or `0.0.0.0:8095` **behind** nginx.
- Do **not** add a firewall rule exposing 8095 to the internet.
- All external traffic should go through HTTPS/443 → nginx → `http://127.0.0.1:8095/efl/pdftotext`.

---

## 10. Checklist

- [ ] Python helper (`efl-pdftotext.service`) is running and listening on 8095.
- [ ] nginx site config includes a `location /efl/pdftotext { ... }` block proxying to `http://127.0.0.1:8095/efl/pdftotext`.
- [ ] `sudo nginx -t` passes and `sudo systemctl reload nginx` has been run.
- [ ] Vercel `EFL_PDFTEXT_URL` is set to `https://<droplet-domain>/efl/pdftotext`.
- [ ] Vercel + droplet `EFL_PDFTEXT_TOKEN` match (quotes are fine; code strips them).
- [ ] Windows `curl.exe` test to `https://<droplet-domain>/efl/pdftotext` returns `{ "ok": true, "text": "..." }`.
- [ ] EFL manual-upload route shows `pdftotext` fallback as attempted and, when successful, reports `extractorMethod: "pdftotext"`.
