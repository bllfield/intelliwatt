# SMT Env Vars (consolidated)

## Droplet
- `SMT_SFTP_HOST` = `ftp.smartmetertexas.biz`
- `SMT_SFTP_PORT` = `22`
- `SMT_SFTP_USER` = `<from SMT>`
- `SMT_SFTP_KEY_PATH` = `/home/deploy/.ssh/intelliwatt_smt_rsa4096`
- `SMT_SFTP_REMOTE_DIR` = `/adhocusage`
- `GNUPG_HOME` = `/home/deploy/.gnupg`
- `PGP_RECIPIENT_FPR` = `<40 char FPR>`
- `BATCH_LIMIT` = `25`
- `LOG_LEVEL` = `info`
- `INTELLIWATT_WEBHOOK_SECRET` = `<64 chars>` (also used by Vercel)
- (optional) `PROXY_SHARED_SECRET` (legacy; avoid in new code)

## Vercel
- `DATABASE_URL` = `<postgres>`
- `ADMIN_TOKEN` = `<opaque>`
- `INTELLIWATT_WEBHOOK_SECRET` = `<same as droplet>`
- `DROPLET_WEBHOOK_URL` = `http://<DROPLET_IP>:8787/trigger/smt-now`
- `DROPLET_WEBHOOK_SECRET` = `<same value as INTELLIWATT_WEBHOOK_SECRET>`

## Webhook auth (SMT droplet)
- `INTELLIWATT_WEBHOOK_SECRET` — primary secret Vercel sends to droplet.
- `DROPLET_WEBHOOK_SECRET` — fallback/alias; keep equal to the above.
- `DROPLET_WEBHOOK_URL` — e.g. `http://<droplet-ip>:8787/trigger/smt-now`
- Header used: `x-intelliwatt-secret`
- **Do not use `x-proxy-secret` (deprecated).**

## Headers
- `x-intelliwatt-secret` = **INTELLIWATT_WEBHOOK_SECRET**
- `x-admin-token` = **ADMIN_TOKEN**
