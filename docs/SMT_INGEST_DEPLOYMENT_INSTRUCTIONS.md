# SMT Ingest Pipeline Deployment Instructions

## Summary

The SMT ingest pipeline has been updated to use the **droplet upload server** instead of inline POST to avoid Vercel's 100MB payload limit. This enables large SMT CSV files (12 months of 15-minute reads) to be ingested without hitting size limits.

**Commit:** `7c5b0a2`  
**Date:** December 4, 2025

## What Changed

### Code Changes
1. **deploy/smt/fetch_and_post.sh** now posts to the droplet upload server instead of inline:
   - Old: Encoded CSV as base64+gzip and POSTed JSON to `/api/admin/smt/pull`
   - New: POSTs multipart/form-data directly to `SMT_UPLOAD_URL` (droplet upload server)
   - Fallback: If `SMT_UPLOAD_URL` is not set, falls back to legacy inline mode (not recommended)

2. **docs/DEPLOY_SMT_INGEST.md** updated with:
   - New configuration steps for `SMT_UPLOAD_URL` env var
   - Explanation of why droplet upload server bypasses Vercel limits
   - Updated "Big-File SMT Interval CSVs vs Inline Uploads" section

### Why This Matters
- Full-year SMT interval CSVs (12 months of 15-minute reads) can be 100+ MB
- Vercel App Router has a ~100MB payload limit
- Encoding as base64+gzip makes the payload even larger
- The droplet upload server accepts files directly via multipart/form-data, bypassing Vercel entirely

## Droplet Configuration Required

### Step 1: Update `/etc/default/intelliwatt-smt`

Add or update the `SMT_UPLOAD_URL` env var:

```bash
SMT_UPLOAD_URL=http://localhost:8081/upload
```

Or if using HTTPS with reverse proxy:

```bash
SMT_UPLOAD_URL=https://smt-upload.intelliwatt.com/upload
```

### Step 2: Ensure smt-upload-server is Running

The droplet upload server must be running on port 8081 (or configured port). Verify:

```bash
sudo systemctl status smt-upload-server.service
```

If not running:

```bash
sudo systemctl enable --now smt-upload-server.service
sudo systemctl start smt-upload-server.service
```

### Step 3: Verify Connectivity

Once configured, the next `smt-ingest.service` run should use the droplet upload server. To test manually:

```bash
sudo systemctl start smt-ingest.service
journalctl -u smt-ingest.service -n 50 -f
```

Watch for logs like:
```
[INFO] Using droplet upload server at http://localhost:8081/upload
[INFO] Droplet upload success (200): ...
```

## Backward Compatibility

If `SMT_UPLOAD_URL` is not set:
- The script will log a warning: "SMT_UPLOAD_URL not configured; will attempt legacy inline POST"
- It will fall back to the old behavior (base64+gzip JSON POST to `/api/admin/smt/pull`)
- **This is not recommended for production** with large files

## Testing

### Test 1: Manual Upload via Admin UI

1. Visit `https://intelliwatt.com/admin/smt/raw`
2. Click "Droplet Upload" tab
3. Select a test CSV file
4. Click "Upload to Droplet"
5. Confirm: File appears in `/admin/smt/raw` "Load Raw Files" list

### Test 2: Verify fetch_and_post.sh Uses Droplet Server

1. Place a test CSV in `/home/deploy/smt_inbox`
2. Run: `sudo systemctl start smt-ingest.service`
3. Check logs: `journalctl -u smt-ingest.service -n 100 -f`
4. Confirm: Logs show "Using droplet upload server" and "Droplet upload success"

### Test 3: Full Production Ingest

1. Verify SMT SFTP fetch works (check droplet logs)
2. Verify `fetch_and_post.sh` posts to droplet upload server
3. Verify droplet upload server receives and processes files
4. Verify `RawSmtFile` record created in database
5. Verify `SmtInterval` records created and visible on usage page

## Rollback Instructions

If issues arise, you can temporarily fall back to inline mode:

1. **Unset `SMT_UPLOAD_URL`** in `/etc/default/intelliwatt-smt`
2. Reload systemd: `sudo systemctl daemon-reload`
3. Restart service: `sudo systemctl restart smt-ingest.service`

The script will automatically fall back to legacy inline mode. However, **note that inline mode will fail for large files**.

## Ops Checklist

- [ ] Code deployed to production (commit `7c5b0a2`)
- [ ] `SMT_UPLOAD_URL` added to `/etc/default/intelliwatt-smt`
- [ ] smt-upload-server.service is running
- [ ] Manual upload test completed (admin UI)
- [ ] Droplet ingest run completed successfully
- [ ] RawSmtFile records visible in `/admin/smt/raw`
- [ ] SmtInterval records present in database
- [ ] Interval data visible on customer usage pages

## Contact

For questions or issues, refer to:
- `docs/DEPLOY_SMT_INGEST.md` - Full deployment guide
- `docs/ENV_VARS.md` - Environment variable reference
- `deploy/smt/fetch_and_post.sh` - Script source code with inline comments
- Git commit `7c5b0a2` - Full diff of changes
