# SMT Ingest Callback Fix

## Problem Summary

The SMT ingest pipeline was **not persisting data to the database** despite logs showing successful uploads and normalization. The root cause was a **missing callback mechanism** in the droplet upload server.

## Root Cause Analysis

### Pipeline Flow (Intended)

1. Droplet fetches CSV from SMT SFTP
2. Droplet POSTs multipart/form-data to droplet upload server at `https://smt-upload.intelliwatt.com/upload`
3. **[MISSING]** Upload server registers file with main app via `/api/admin/smt/raw-upload`
4. **[MISSING]** Upload server triggers normalization via `/api/admin/smt/normalize`
5. Normalization parses CSV → creates `RawSmtFile` → produces `SmtInterval` records
6. User can see data on usage page

### What Was Actually Happening

1. ✅ Droplet fetches CSV from SMT SFTP
2. ✅ Droplet POSTs to droplet upload server
3. ✅ Upload server saves file to `/home/deploy/smt_inbox`
4. ✅ Upload server triggers `smt-ingest.service`
5. ❌ `smt-ingest.service` runs `fetch_and_post.sh` again (not the file that was just uploaded)
6. ❌ No RawSmtFile record created
7. ❌ No SmtInterval data written to database
8. ❌ No data visible on usage page

### Why This Happened

The droplet upload server (`scripts/droplet/smt-upload-server.ts`) was incomplete:
- It saved the file ✓
- It triggered `smt-ingest.service` ✓
- But then **did nothing else** ✗

The `smt-ingest.service` runs `fetch_and_post.sh`, which:
- Checks SFTP for new files
- Posts them to the upload server
- But **does not register files that are already in the inbox**

This created a gap: Files were uploaded to the server but never registered or normalized.

## Solution Implemented

Updated `scripts/droplet/smt-upload-server.ts` to add **callback webhook functionality**:

### New Behavior

After uploading and saving a file, the server now:

1. **Computes SHA256 hash** of the uploaded file
2. **Registers the file** by calling `/api/admin/smt/raw-upload` with:
   - `filename`: Original filename
   - `size_bytes`: File size
   - `sha256`: File hash
   - `source`: "droplet-upload" 
   - `received_at`: Current timestamp

3. **Triggers normalization** by calling `/api/admin/smt/normalize` with:
   - Processes the newly registered RawSmtFile
   - Parses CSV and creates SmtInterval records
   - Returns counts of files processed and intervals inserted

### Key Implementation Details

- **Authentication**: Uses `ADMIN_TOKEN` environment variable
- **Base URL**: Uses `INTELLIWATT_BASE_URL` environment variable
- **Fire-and-forget**: Normalization happens in background; response sent before completion
- **Logging**: All steps logged for debugging
- **Error handling**: Non-fatal errors logged but don't block the HTTP response

### Code Changes

```typescript
// New environment variables needed
const INTELLIWATT_BASE_URL = process.env.INTELLIWATT_BASE_URL || "https://intelliwatt.com";
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || "";

// New async function to handle registration + normalization
async function registerAndNormalizeFile(
  filepath: string,
  filename: string,
  size_bytes: number,
): Promise<void>

// New helper to compute SHA256
async function computeFileSha256(filepath: string): Promise<string>

// In /upload endpoint, after saving file:
registerAndNormalizeFile(destPath, file.originalname || file.filename || "upload.csv", sizeGuess)
  .catch(err => {
    console.error("[smt-upload] background registration/normalization failed:", err);
  });
```

## Deployment Instructions

### For the Droplet

1. **Pull latest code** containing the updated `scripts/droplet/smt-upload-server.ts`
   ```bash
   cd /home/deploy/apps/intelliwatt
   git pull origin main
   ```

2. **Recompile TypeScript** (if running from TS)
   ```bash
   npm run build:droplet-smt-upload-server
   # Or manually:
   npx tsc scripts/droplet/smt-upload-server.ts --target ES2020 --module commonjs --outDir scripts/droplet
   ```

3. **Verify environment variables** in `/etc/default/intelliwatt-smt`
   ```bash
   # Must have:
   INTELLIWATT_BASE_URL=https://intelliwatt.com
   ADMIN_TOKEN=<your-64-char-admin-token>
   SMT_UPLOAD_URL=https://smt-upload.intelliwatt.com/upload  # or http://localhost:8081/upload
   ```

4. **Restart the upload server**
   ```bash
   sudo systemctl restart smt-upload-server.service
   # Verify it's running:
   sudo systemctl status smt-upload-server.service
   journalctl -u smt-upload-server.service -n 50 -f
   ```

### For the Main App

No changes needed to the main app - the endpoints already exist:
- `/api/admin/smt/raw-upload` (creates RawSmtFile records)
- `/api/admin/smt/normalize` (processes RawSmtFile and creates SmtInterval records)

## Verification

### Check if Fix is Working

1. **Monitor the upload server logs**
   ```bash
   journalctl -u smt-upload-server.service -f
   ```
   Look for lines like:
   ```
   [smt-upload] computed sha256=abc123... for file=/home/deploy/smt_inbox/...
   [smt-upload] registering raw file at https://intelliwatt.com/api/admin/smt/raw-upload
   [smt-upload] raw file registered: {"ok":true,"id":"123","filename":"..."}
   [smt-upload] triggering normalization at https://intelliwatt.com/api/admin/smt/normalize
   [smt-upload] normalization complete: filesProcessed=1 intervalsInserted=1234
   ```

2. **Check the database**
   ```bash
   psql $DATABASE_URL -c "SELECT COUNT(*) FROM \"SmtInterval\" WHERE esiid='10443720004895510';"
   ```
   Should show > 0 intervals after a successful ingest

3. **Check the usage page**
   - Visit user's usage dashboard
   - Data should be visible for the date range of the uploaded CSV

## Troubleshooting

### No data still appearing

1. **Check upload server is running**
   ```bash
   sudo systemctl status smt-upload-server.service
   ```

2. **Check environment variables are set**
   ```bash
   grep -E "INTELLIWATT_BASE_URL|ADMIN_TOKEN" /etc/default/intelliwatt-smt
   ```

3. **Check main app can receive POST requests**
   ```bash
   curl -X POST https://intelliwatt.com/api/admin/smt/raw-upload \
     -H "Authorization: Bearer YOUR_ADMIN_TOKEN" \
     -H "Content-Type: application/json" \
     -d '{"filename":"test.csv","size_bytes":1000,"sha256":"abc123"}'
   ```

4. **Check logs on main app**
   ```bash
   # Vercel logs (if deployed there)
   vercel logs --follow
   # Or local logs if running locally
   ```

### Upload server responds but no data inserted

1. Check if main app's `/api/admin/smt/normalize` endpoint is working
   ```bash
   curl -X POST "https://intelliwatt.com/api/admin/smt/normalize?limit=1" \
     -H "Authorization: Bearer YOUR_ADMIN_TOKEN" \
     -H "Content-Type: application/json" \
     -d '{}'
   ```

2. Check if RawSmtFile records are being created
   ```bash
   psql $DATABASE_URL -c "SELECT COUNT(*) FROM raw_smt_files WHERE source='droplet-upload';"
   ```

3. Check normalization logs in main app for CSV parsing errors
   - Look for: `[smt/pull:inline] normalizeSmtIntervals result`
   - Check `stats` for `invalidEsiid`, `invalidTimestamp`, `invalidKwh`

## Impact

✅ **Fixed**: Data from droplet-uploaded SMT CSVs now persists to database
✅ **Fixed**: SmtInterval records created from uploaded files
✅ **Fixed**: Data now visible on usage page
✅ **Improved**: Clearer logs showing callback progress
✅ **Improved**: Full pipeline is now end-to-end testable

## Files Modified

- `scripts/droplet/smt-upload-server.ts` (main fix)
- `scripts/droplet/smt-upload-server.js` (compiled from TS)
- `scripts/droplet/smt-upload-server.d.ts` (type definitions)

## Testing with ESIID 10443720004895510

To test the full pipeline:

1. Create a test CSV with this ESIID
2. Upload via `/admin/smt/raw` UI or via curl:
   ```bash
   curl -F "file=@test.csv" https://smt-upload.intelliwatt.com/upload
   ```
3. Monitor logs for callback success
4. Check database for SmtInterval records
5. Verify data on usage page

## References

- `/api/admin/smt/raw-upload` - Registers raw file with database
- `/api/admin/smt/normalize` - Processes RawSmtFile records
- `app/lib/smt/normalize.ts` - CSV parsing logic
- `lib/usage/dualWriteUsageIntervals` - Database write logic
- `deploy/smt/fetch_and_post.sh` - Droplet SFTP sync script
