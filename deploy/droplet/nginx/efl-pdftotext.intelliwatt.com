server {
  server_name efl-pdftotext.intelliwatt.com;

  client_max_body_size 25m;

  location /health {
    proxy_pass http://127.0.0.1:8095/health;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
  }

  location /efl/pdftotext {
    proxy_pass http://127.0.0.1:8095/efl/pdftotext;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_read_timeout 120s;
  }

    listen 443 ssl; # managed by Certbot
    ssl_certificate /etc/letsencrypt/live/efl-pdftotext.intelliwatt.com/fullchain.pem; # managed by Certbot
    ssl_certificate_key /etc/letsencrypt/live/efl-pdftotext.intelliwatt.com/privkey.pem; # managed by Certbot
    include /etc/letsencrypt/options-ssl-nginx.conf; # managed by Certbot
    ssl_dhparam /etc/letsencrypt/ssl-dhparams.pem; # managed by Certbot

}
server {
    if ($host = efl-pdftotext.intelliwatt.com) {
        return 301 https://$host$request_uri;
    } # managed by Certbot


  listen 80;
  server_name efl-pdftotext.intelliwatt.com;
    return 404; # managed by Certbot


}