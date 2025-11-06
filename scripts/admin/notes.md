# Admin Scripts Notes

## Daily Summary Endpoint

**Route**: `GET/POST /api/admin/analysis/daily-summary`

**Auth**: Requires `x-admin-token` header

**Query Parameters (GET)**:
- `esiid` (optional) - Filter by ESIID
- `meter` (optional) - Filter by meter
- `dateStart` (optional) - Start date YYYY-MM-DD (default: 7 days ago)
- `dateEnd` (optional) - End date YYYY-MM-DD (default: today)
- `tz` (optional) - Timezone (default: America/Chicago)

**Body (POST)**:
```json
{
  "esiid": "1044...AAA",
  "meter": "M1",
  "dateStart": "2025-10-30",
  "dateEnd": "2025-11-05",
  "tz": "America/Chicago"
}
```

**Response**:
```json
{
  "ok": true,
  "corrId": "uuid-or-from-header",
  "rows": [
    {
      "esiid": "1044...AAA",
      "meter": "M1",
      "date": "2025-11-05",
      "totalSlots": 96,
      "realCount": 94,
      "filledCount": 2,
      "completeness": 1.0,
      "kWh_real": 12.5,
      "kWh_filled": 0.0,
      "kWh_total": 12.5,
      "has_missing": false
    }
  ]
}
```

**Notes**:
- Uses SQL-based aggregation for performance (handles large datasets efficiently)
- DST-aware: automatically calculates correct slot counts (92/96/100 per day)
- Correlation ID: Uses `x-corr-id` or `x-request-id` header if provided, otherwise generates UUID
- Observability: Logs to console with `corrId`, `route`, `method`, `status`, `durationMs`, `count`
- Default date range: Last 7 days if not specified

**PowerShell Example**:
```powershell
$headers = @{
    "x-admin-token" = $env:ADMIN_TOKEN
}

# Get summary for last 7 days
Invoke-RestMethod -Uri "https://intelliwatt.com/api/admin/analysis/daily-summary?dateStart=2025-10-30&dateEnd=2025-11-05" `
    -Method GET `
    -Headers $headers
```

## Catch-Up Normalization Cron

**Route**: `POST /api/admin/cron/normalize-smt-catch`

**Auth**: Requires `x-vercel-cron` header (automatically added by Vercel) + optional `x-cron-secret` if `CRON_SECRET` is set

**Behavior**:
- Looks back 3 days (local time)
- Finds days with `has_missing=true` from daily summary
- Attempts to fetch raw data and normalize missing intervals
- Persists with same guards as ingest-normalize (zeros never overwrite real data)

**Current Schedule**: Every 1 minute (`*/1 * * * *`)

**Optional Daily Schedule**: To run once per day at 4 AM UTC (11 PM CT previous day), add to `vercel.json`:
```json
{
  "path": "/api/admin/cron/normalize-smt-catch",
  "schedule": "0 4 * * *"
}
```

**Manual Test** (requires cron headers):
```powershell
$headers = @{
    "x-vercel-cron" = "1"
    # "x-cron-secret" = $env:CRON_SECRET  # if set
}

Invoke-RestMethod -Uri "https://intelliwatt.com/api/admin/cron/normalize-smt-catch" `
    -Method POST `
    -Headers $headers
```

## Observability

All endpoints include:
- `corrId` - Correlation ID for tracing (from `x-corr-id` or `x-request-id` header, or auto-generated)
- Structured JSON logging to console with:
  - `corrId` - Correlation ID
  - `route` - Route path (e.g., `admin/analysis/daily-summary`)
  - `method` - HTTP method (GET/POST)
  - `status` - HTTP status code
  - `durationMs` - Request duration in milliseconds
  - `count` - Number of results (for successful requests)
  - `errorClass` - Error classification (for failures)
  - `message` - Error message (for failures)

**Check Vercel function logs** for detailed execution traces. Logs are structured JSON for easy parsing.

**Example log entry**:
```json
{
  "corrId": "abc123...",
  "route": "admin/analysis/daily-summary",
  "method": "GET",
  "status": 200,
  "durationMs": 145,
  "count": 5
}
```

## Daily Completeness & Catch-Up Sweep

### Summary (last 7 days)

```powershell
$env:ADMIN_TOKEN = '<ADMIN_TOKEN>'
.\scripts\admin\Invoke-Intelliwatt.ps1 -Uri 'https://intelliwatt.com/api/admin/analysis/daily-summary'
```

This will return daily summaries for the last 7 days, showing:
- `completeness` - Percentage of expected 15-minute intervals present (0.0 to 1.0)
- `has_missing` - Boolean indicating if any intervals are missing
- `kWh_real` vs `kWh_filled` - Breakdown of real readings vs gap-filled placeholders

**Filter by ESIID/Meter**:
```powershell
.\scripts\admin\Invoke-Intelliwatt.ps1 -Uri 'https://intelliwatt.com/api/admin/analysis/daily-summary?esiid=1044...AAA&meter=M1'
```

**Custom date range** (supports both YYYY-MM-DD and ISO timestamp formats):
```powershell
# Date format (YYYY-MM-DD)
.\scripts\admin\Invoke-Intelliwatt.ps1 -Uri 'https://intelliwatt.com/api/admin/analysis/daily-summary?dateStart=2025-11-01&dateEnd=2025-11-05'

# ISO timestamp format (with timezone)
.\scripts\admin\Invoke-Intelliwatt.ps1 -Uri 'https://intelliwatt.com/api/admin/analysis/daily-summary?esiid=1044...AAA&meter=M1&dateStart=2025-10-28T00:00:00Z&dateEnd=2025-11-06T00:00:00Z'
```

**Note**: ISO timestamps are automatically converted to local dates (America/Chicago timezone) for aggregation.

### Catch-Up Sweep

The catch-up cron (`/api/admin/cron/normalize-smt-catch`) automatically:
1. Checks last 3 days for `has_missing=true`
2. Attempts to fetch raw data for missing intervals
3. Normalizes and persists with idempotent guards

**Manual catch-up sweep** (idempotent):
```powershell
Invoke-RestMethod -Uri 'https://intelliwatt.com/api/admin/cron/normalize-smt-catch' `
    -Method POST `
    -Headers @{ 'x-vercel-cron'='1'; 'x-cron-secret'='<CRON_SECRET>' }
```

**Note**: Expect 92/96/100 `totalSlots` around DST transitions (America/Chicago):
- **92 slots**: Spring forward day (loses 1 hour = 4 slots)
- **96 slots**: Normal day
- **100 slots**: Fall back day (gains 1 hour = 4 slots)

The daily summary automatically calculates the correct slot count for each day based on DST transitions.

**Workflow**:
1. Run daily summary to identify missing days
2. Catch-up cron automatically processes missing intervals (runs every 1 minute)
3. Re-run summary to verify completeness improved

## Utilities

### Generate Secure Secrets

Generate a random 32-byte hex string for `CRON_SECRET`, `ADMIN_TOKEN`, or `SHARED_INGEST_SECRET`:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

This generates a 64-character hexadecimal string suitable for use as a secure token.
