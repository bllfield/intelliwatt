# IntelliWatt — Automation Status (Normalization & Rates)

**Last Updated:** 2025-01-05

## Automation Modes

- **Vercel Scheduled Functions (Option A)** — *Active*
  - `/api/admin/rates/refresh` (2:00 AM UTC daily)
  - `/api/rates/efl-refresh` (3:00 AM UTC daily)
  - `/api/admin/cron/normalize-smt` (every 5 minutes)
  - `/api/admin/cron/normalize-smt-catch` (every 1 minute - catch-up sweep)
  - **Auth:** `x-vercel-cron` header required, optional `CRON_SECRET` supported (see below).

- **Droplet systemd timers (Option B)** — *Planned/Potential*
  - No evidence found in codebase for active systemd timers
  - Manual scripts exist (`scripts/smoke-test-deploy.ps1`) that could be automated
  - SMT normalization-save cycle could be automated via droplet timer calling `/api/admin/analysis/normalize-smt` with `x-admin-token`

## Evidence

### Vercel Cron Jobs

**File**: `vercel.json`
- Lists 4 cron paths/schedules:
  - `"/api/admin/rates/refresh"` → `"0 2 * * *"` (2:00 AM UTC daily)
  - `"/api/rates/efl-refresh"` → `"0 3 * * *"` (3:00 AM UTC daily)
  - `"/api/admin/cron/normalize-smt"` → `"*/5 * * * *"` (every 5 minutes)
  - `"/api/admin/cron/normalize-smt-catch"` → `"*/1 * * * *"` (every 1 minute)

**Implementation**:
- `app/api/admin/rates/refresh/route.ts` - Nightly rates discovery + EFL refresh (Texas TDSPs)
- `app/api/rates/efl-refresh/route.ts` - Nightly EFL refresher to update RateConfig
- `app/api/admin/cron/normalize-smt/route.ts` - 5-minute SMT normalization sweep (TODO: implement)
- `app/api/admin/cron/normalize-smt-catch/route.ts` - 1-minute catch-up sweep (placeholder/no-op)
- All routes protected by `requireVercelCron()` from `lib/auth/cron.ts`

**Authentication**:
- Requires `x-vercel-cron` header (automatically added by Vercel)
- Optional `CRON_SECRET` check if env var is set
- See `lib/auth/cron.ts` for implementation

**Verification**:
- Function logs in Vercel show nightly executions for both endpoints
- Check Vercel Dashboard → Project → Settings → Cron Jobs

### Droplet Timers

**Status**: *Not found in codebase*

**Potential Implementation**:
- Could use `systemctl list-timers --all` to check for:
  - `intelliwatt-smt-cycle.timer` (SMT normalization cycle)
  - `intelliwatt-mv-refresh.timer` (auxiliary refresh job)
- Service would call `https://intelliwatt.com/api/admin/analysis/normalize-smt` with `x-admin-token` from droplet `EnvironmentFile`

**Manual Scripts Found**:
- `scripts/smoke-test-deploy.ps1` - Manual smoke test (not automated)
- `scripts/admin/Invoke-Intelliwatt.ps1` - Admin API wrapper (helper script)

## Authentication Patterns

### Admin Routes
- Protected by `requireAdmin()` from `lib/auth/admin.ts`
- Require `x-admin-token` header matching `ADMIN_TOKEN` env var
- Used by manual scripts and potential droplet automation
- Example: `/api/admin/analysis/normalize-smt`

### Cron Routes (Vercel Scheduled)
- Protected by `requireVercelCron()` from `lib/auth/cron.ts`
- Require `x-vercel-cron` header (automatically added by Vercel)
- Optional: If `CRON_SECRET` is set in Vercel env, caller must also include `x-cron-secret: $CRON_SECRET`
- Examples: `/api/admin/rates/refresh`, `/api/rates/efl-refresh`

**Implementation** (`lib/auth/cron.ts`):
```typescript
export function requireVercelCron(req: NextRequest) {
  const cronHeader = req.headers.get('x-vercel-cron');
  const secret = process.env.CRON_SECRET;
  const provided = req.headers.get('x-cron-secret');

  if (!cronHeader) {
    return NextResponse.json({ ok: false, error: 'UNAUTHORIZED_CRON' }, { status: 401 });
  }
  if (secret && provided !== secret) {
    return NextResponse.json({ ok: false, error: 'BAD_CRON_SECRET' }, { status: 401 });
  }
  return null; // ok
}
```

## Environment Variables

### Vercel
- `DATABASE_URL` (Postgres) - Required
- `WATTBUY_API_KEY` - Required for `/api/admin/rates/refresh`
- `CRON_SECRET` *(optional, recommended)* - Additional security for cron routes
- `SHARED_INGEST_SECRET` - Required for `/api/internal/smt/ingest-normalize` (fast path)

### Droplet (if using systemd timers)
- `ADMIN_TOKEN` in service `EnvironmentFile` - Required for admin route calls
- SMT SFTP creds (unrelated to cron auth)

## Runbooks

### Vercel Scheduled Functions

**View Schedules**:
- Vercel → Project → Settings → **Cron Jobs**
- Verify both jobs are listed and show recent execution history

**View Logs**:
- Vercel → Project → Functions → Filter by route
- Check logs for `/api/admin/rates/refresh` at ~2:00 AM UTC
- Check logs for `/api/rates/efl-refresh` at ~3:00 AM UTC

**Manual Test (Simulated)**:
```bash
# Test rates refresh (requires x-vercel-cron header)
curl -X POST "https://intelliwatt.com/api/admin/rates/refresh" \
  -H "x-vercel-cron: 1" \
  -H "x-cron-secret: $CRON_SECRET"  # if CRON_SECRET is set

# Test EFL refresh
curl -X POST "https://intelliwatt.com/api/rates/efl-refresh" \
  -H "x-vercel-cron: 1" \
  -H "x-cron-secret: $CRON_SECRET"  # if CRON_SECRET is set
```

**PowerShell Test**:
```powershell
$headers = @{
    "x-vercel-cron" = "1"
    # "x-cron-secret" = $env:CRON_SECRET  # if set
}

Invoke-RestMethod -Uri "https://intelliwatt.com/api/admin/rates/refresh" `
    -Method POST `
    -Headers $headers
```

### Droplet Timers (If Implemented)

**Check Status**:
```bash
systemctl list-timers --all | grep intelliwatt
systemctl status intelliwatt-smt-cycle.timer
systemctl status intelliwatt-mv-refresh.timer
```

**View Service Logs**:
```bash
journalctl -u intelliwatt-smt-cycle.service -f
```

**Manual Trigger**:
```bash
systemctl start intelliwatt-smt-cycle.service
```

## Security Recommendations

### Current State
✅ Cron routes now require `x-vercel-cron` header  
✅ Optional `CRON_SECRET` support added for additional security  
⚠️ Admin routes remain publicly accessible if URL is known (protected by `ADMIN_TOKEN`)

### Best Practices
1. **Set `CRON_SECRET` in Vercel**:
   - Add `CRON_SECRET` to Vercel environment variables
   - Vercel cron jobs will need to include this header (may require custom configuration)
   - Note: Vercel automatically adds `x-vercel-cron`, but custom headers may need manual setup

2. **Monitor Cron Executions**:
   - Set up alerts for failed cron executions
   - Review logs regularly for unexpected behavior

3. **Admin Route Security**:
   - Rotate `ADMIN_TOKEN` periodically
   - Use different tokens for Production vs Preview environments
   - Never commit tokens to repository

## Adding New Scheduled Jobs

### Vercel Cron

1. **Add to `vercel.json`**:
   ```json
   {
     "crons": [
       {
         "path": "/api/your-route",
         "schedule": "0 4 * * *"
       }
     ]
   }
   ```

2. **Implement Route**:
   - Create route handler in `app/api/your-route/route.ts`
   - Add `requireVercelCron()` check at start of handler
   - Deploy to trigger Vercel cron registration

3. **Verify**:
   - Check Vercel dashboard for new cron job
   - Monitor logs after first scheduled run

### Droplet Timer (If Needed)

1. **Create Service File** (`/etc/systemd/system/intelliwatt-<name>.service`):
   ```ini
   [Unit]
   Description=IntelliWatt <name> job
   After=network.target

   [Service]
   Type=oneshot
   EnvironmentFile=/etc/intelliwatt/env
   ExecStart=/usr/bin/curl -X POST "https://intelliwatt.com/api/admin/your-route" \
     -H "x-admin-token: ${ADMIN_TOKEN}" \
     -H "Content-Type: application/json"
   ```

2. **Create Timer File** (`/etc/systemd/system/intelliwatt-<name>.timer`):
   ```ini
   [Unit]
   Description=IntelliWatt <name> timer
   Requires=intelliwatt-<name>.service

   [Timer]
   OnCalendar=*-*-* 04:00:00
   Persistent=true

   [Install]
   WantedBy=timers.target
   ```

3. **Enable and Start**:
   ```bash
   sudo systemctl daemon-reload
   sudo systemctl enable intelliwatt-<name>.timer
   sudo systemctl start intelliwatt-<name>.timer
   ```

## Fast Path — On-Demand SMT Normalize (Seconds-latency)

**Endpoint:** `POST /api/internal/smt/ingest-normalize`  
**Auth:** `x-shared-secret: $SHARED_INGEST_SECRET` (Vercel env)  
**Caller:** Droplet immediately after raw ingest (or UI-driven on demand)

**Bodies supported:**

- **Direct rows:** `{ esiid, meter, rows:[...] }`
- **Window:** `{ esiid, meter, from, to }`

**Response:** `{ ok, processed, normalizedPoints, persisted }`

**Notes:** Uses cached WattBuy plans later in analysis; no WattBuy call needed here.

## Fast On-Demand SMT Normalize (Production)

**Endpoint**: `POST /api/internal/smt/ingest-normalize`  

**Auth**: `x-shared-secret: $SHARED_INGEST_SECRET` (Vercel env + droplet env)  

**Bodies**:

- Direct rows:

  ```json
  {
    "esiid": "1044...AAA",
    "meter": "M1",
    "rows": [
      { "timestamp": "2025-10-30T13:15:00-05:00", "kwh": 0.25 },
      { "start": "2025-10-30T18:00:00-05:00", "end": "2025-10-30T18:15:00-05:00", "value": "0.30" }
    ]
  }
  ```

- Windowed fetch (if rows aren't passed):

  ```json
  { "esiid":"1044...AAA","meter":"M1","from":"2025-10-30T18:00:00-05:00","to":"2025-10-30T19:00:00-05:00" }
  ```

**Persistence policy**:

- Default `saveFilled=true`: zero placeholders are written to DB.
- Guard: a zero never overwrites a real reading; a later real reading upgrades a zero.

**Readback**:

- `GET /api/admin/analysis/intervals?esiid=...&meter=...&date=YYYY-MM-DD&tz=America/Chicago` (admin-gated)

**WattBuy**: Plans are pulled nightly and cached; no extra WattBuy call on SMT arrival.

## SMT Live Ingest Automation

- [x] **On-demand ingest on SMT authorization (2025-11-19)**
  - `POST /api/smt/authorization` sends `reason: "smt_authorized"` to `DROPLET_WEBHOOK_URL` signed by the webhook secret.
  - Droplet `smt-webhook.service` validates the header, logs the payload, and calls `deploy/smt/fetch_and_post.sh` with `ESIID_DEFAULT` from the payload.
  - `fetch_and_post.sh` SFTPs new SMT CSVs and posts them inline to `/api/admin/smt/pull`; interval CSVs auto-normalize into `SmtInterval`.
  - SMT remains droplet-only (JWT + SFTP). Vercel never calls SMT APIs directly.

## Related Documentation

- `docs/ADMIN_API.md` - Admin endpoint authentication patterns
- `docs/QUICK_START.md` - Quick reference for environment setup
- `scripts/admin/Invoke-Intelliwatt.ps1` - Admin API wrapper script
- `lib/auth/cron.ts` - Cron authentication helper
- `lib/auth/admin.ts` - Admin authentication helper
- `lib/auth/shared.ts` - Shared secret authentication helper
