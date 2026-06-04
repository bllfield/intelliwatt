##
## IntelliWatt Green Button big-file upload vhost (uploads.intelliwatt.com)
##
## Proxies to green-button-upload-server on 127.0.0.1:8091
##

server {
    listen 80;
    listen [::]:80;
    server_name uploads.intelliwatt.com;
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl;
    listen [::]:443 ssl;
    server_name uploads.intelliwatt.com;

    ssl_certificate     /etc/letsencrypt/live/uploads.intelliwatt.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/uploads.intelliwatt.com/privkey.pem;
    include /etc/letsencrypt/options-ssl-nginx.conf;
    ssl_dhparam /etc/letsencrypt/ssl-dhparams.pem;

    client_max_body_size 524288000;

    # CORS on nginx errors (504 without this shows as "CORS blocked" in the browser).
    add_header Access-Control-Allow-Origin "https://intelliwatt.com" always;
    add_header Access-Control-Allow-Methods "GET, POST, OPTIONS" always;
    add_header Access-Control-Allow-Headers "Content-Type, X-Green-Button-Payload, X-Green-Button-Signature" always;
    add_header Vary "Origin" always;

    if ($request_method = OPTIONS) {
        return 204;
    }

    location / {
        proxy_pass http://127.0.0.1:8091;

        # Node also sets CORS; hide upstream so only one Allow-Origin is sent (browser rejects duplicates).
        proxy_hide_header Access-Control-Allow-Origin;
        proxy_hide_header Access-Control-Allow-Methods;
        proxy_hide_header Access-Control-Allow-Headers;
        proxy_hide_header Vary;

        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        proxy_connect_timeout 30s;
        proxy_send_timeout 600s;
        proxy_read_timeout 600s;
        proxy_request_buffering on;
    }
}
