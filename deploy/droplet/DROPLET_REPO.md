# Droplet repo checkout

**User:** `deploy`

`post_pull.sh` discovers the repo by walking up until it finds `deploy/droplet`. Use whichever checkout path exists on the host (`~/apps/intelliwatt` or `~/apps/intelliwatt-clean`). `apply_droplet_services.sh` patches systemd units to match that path.

```bash
cd ~/apps/intelliwatt   # or ~/apps/intelliwatt-clean
git pull origin main
sudo bash deploy/droplet/post_pull.sh
```

Green Button uploads: browser → Vercel ticket → `https://uploads.intelliwatt.com/upload` (this droplet, port 8091). `post_pull` applies nginx (600s timeout, dedupes duplicate vhosts) and restarts `green-button-upload-server.service`.

After pull, confirm no nginx conflict:

```bash
sudo nginx -t 2>&1 | grep -i conflicting || echo "OK: no duplicate uploads vhost"
curl -sS https://uploads.intelliwatt.com/health
```
