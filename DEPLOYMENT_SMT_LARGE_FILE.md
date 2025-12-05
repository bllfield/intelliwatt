# SMT Large-File Ingestion Deployment Instructions

## Changes Implemented

### 1. raw-upload API (app/api/admin/smt/raw-upload/route.ts)
- ✅ Accepts optional `contentBase64` parameter
- ✅ Stores decoded Buffer in `RawSmtFile.content` (Bytes field)
- ✅ Maintains backward compatibility (doesn't require contentBase64)
- ✅ Logs whether content was provided

### 2. normalize API (app/api/admin/smt/normalize/route.ts)
- ✅ Prefers `RawSmtFile.content` for CSV data
- ✅ Falls back to S3 storage for legacy records
- ✅ Logs which source is used (content vs S3)

### 3. smt-upload-server (scripts/droplet/smt-upload-server.ts)
- ✅ Reads file content from disk
- ✅ Encodes as base64 and includes in raw-upload payload
- ✅ Deletes file after successful normalization
- ✅ Keeps file on error for manual inspection

## Deployment Steps

### Step 1: Vercel (Auto-deployed)
The API changes (raw-upload and normalize) will auto-deploy via Vercel when you push to main.
- Check: https://vercel.com/brian-lee-littlefields-projects/intelliwatt

### Step 2: Droplet (Manual Deployment Required)

SSH to droplet and run:

```bash
ssh root@68.183.139.231

# Navigate to repo
cd /root/intelliwatt

# Pull latest changes
git pull origin main

# Restart the upload server
systemctl restart smt-upload-server.service

# Check status
systemctl status smt-upload-server.service

# Watch logs for next file upload
journalctl -u smt-upload-server -f
```

### Step 3: Trigger Test (Optional)

Force SMT ingest to run immediately:

```bash
# On droplet
systemctl start smt-ingest.service

# Watch logs
journalctl -u smt-ingest.service -f
journalctl -u smt-upload-server -f
```

### Step 4: Verify Data Flow

After the next SMT file arrives:

1. Check upload server logs for:
   - "read file content: X bytes"
   - "contentBase64 provided"
   - "filesProcessed=1 intervalsInserted=96"
   - "deleted local file after normalization"

2. Check database for new SmtInterval records:
```sql
SELECT esiid, COUNT(*), MAX(ts) 
FROM "SmtInterval" 
WHERE esiid IN ('10443720004895510', '10443720004766435')
GROUP BY esiid;
```

3. Check disk space is being cleaned:
```bash
# Should have minimal files after processing
ls -lah /home/deploy/smt_inbox/
du -sh /home/deploy/smt_inbox/
```

## Optional Cleanup (Manual)

If you want to clean up old files from testing:

```bash
# On droplet - BE CAREFUL, this deletes files!
cd /home/deploy/smt_inbox
ls -lah

# Remove old processed files (verify first!)
# rm -f *.csv
```

## Troubleshooting

### If files aren't being deleted:
- Check logs: `journalctl -u smt-upload-server -n 100`
- Look for "deleted local file" or "keeping file" messages
- Verify filesProcessed > 0 in normalization response

### If data still not showing:
- Verify RawSmtFile has content: Check analyze-file-processing.js script
- Check for ESIIDs in database: Check check-smt-authorizations.js script
- Verify SMT agreements are ACTIVE (not revoked_conflict)

### If disk fills up again:
- Files are kept on error for manual inspection
- Check for normalization failures in logs
- Manually remove old files after fixing issues
