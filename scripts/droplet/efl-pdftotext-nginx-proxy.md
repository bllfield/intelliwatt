# Nginx Proxy Snippet for EFL `pdftotext` Helper

Add this `location` block inside your HTTPS `server { ... }` block (port 443) on the droplet:

```nginx
location /efl/pdftotext {
    # Limit body size for EFL PDFs (25 MB is usually plenty)
    client_max_body_size 25m;

    proxy_pass http://127.0.0.1:8095/efl/pdftotext;

    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;

    proxy_read_timeout  60s;
    proxy_connect_timeout 30s;
    proxy_send_timeout 60s;
}
```

After editing the nginx site file:

```bash
sudo nginx -t
sudo systemctl reload nginx
```

Then tail the helper logs to confirm requests are flowing:

```bash
sudo journalctl -u efl-pdftotext.service -n 200 -f
```
