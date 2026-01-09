##
## IntelliWatt EFL pdftotext helper vhost
##
## This nginx site terminates TLS for:
##   https://efl-pdftotext.intelliwatt.com
##
## and proxies:
##   /efl/pdftotext -> http://127.0.0.1:8095/efl/pdftotext
##   /efl/fetch     -> http://127.0.0.1:8088/efl/fetch   (EFL fetch proxy; optional)
##   /health        -> http://127.0.0.1:8095/health
##

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

    # Certbot will manage these paths.
    ssl_certificate     /etc/letsencrypt/live/efl-pdftotext.intelliwatt.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/efl-pdftotext.intelliwatt.com/privkey.pem;
    include /etc/letsencrypt/options-ssl-nginx.conf;
    ssl_dhparam /etc/letsencrypt/ssl-dhparams.pem;

    # EFL PDFs are small, but give safe headroom (25 MB or higher if needed)
    client_max_body_size 25m;

    location /efl/pdftotext {
        proxy_pass http://127.0.0.1:8095/efl/pdftotext;

        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # OCR fallback for scanned PDFs can take longer than pdftotext.
        proxy_read_timeout  180s;
        proxy_connect_timeout 30s;
        proxy_send_timeout 180s;
    }

    # Optional: EFL fetch proxy endpoint (used when some hosts block Vercel/AWS IP ranges)
    location /efl/fetch {
        proxy_pass http://127.0.0.1:8088/efl/fetch;

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

