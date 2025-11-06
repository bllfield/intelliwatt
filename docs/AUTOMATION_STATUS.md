# IntelliWatt Automation Status

**Last Updated**: 2025-01-05

## Automation Mode

**Vercel Scheduled Function**

## Evidence

### Vercel Cron Jobs

**File**: `vercel.json`

Two scheduled functions are configured:

1. **`/api/admin/rates/refresh`**
   - Schedule: `0 2 * * *` (2:00 AM UTC daily)
   - Purpose: Nightly rates discovery + EFL refresh (Texas TDSPs)
   - Route: `app/api/admin/rates/refresh/route.ts`
   - Authentication: **None detected** (POST endpoint, no admin gate or CRON_SECRET check)

2. **`/api/rates/efl-refresh`**
   - Schedule: `0 3 * * *` (3:00 AM UTC daily)
   - Purpose: Nightly EFL refresher — fetch EFL URLs, parse, and update RateConfig
   - Route: `app/api/rates/efl-refresh/route.ts`
   - Authentication: **None detected** (POST endpoint, no admin gate or CRON_SECRET check)

### Cron Route Implementation Details

**File**: `app/api/admin/rates/refresh/route.ts`
- Line 18: Comment mentions "Production tip (Vercel Cron)"
- Line 55: `export async function POST(req: NextRequest)` - No authentication middleware
- No `requireAdmin`, `CRON_SECRET`, or `vercel-cron` header checks found

**File**: `app/api/rates/efl-refresh/route.ts`
- Line 12: Comment mentions "Hook this up to your scheduler/cron after testing in dev"
- Line 31: `export async function POST(req: NextRequest)` - No authentication middleware
- No `requireAdmin`, `CRON_SECRET`, or `vercel-cron` header checks found

### Droplet/Orchestrator References

**Manual Scripts Found** (not automated):

1. **`scripts/smoke-test-deploy.ps1`**
   - Purpose: Manual smoke test script for SMT SFTP, API uploads, WattBuy, and DB endpoints
   - Line 163, 191: Uses `x-admin-token` header with `ADMIN_TOKEN` from user input
   - Line 168: Calls `/api/admin/smt/raw-upload`
   - Line 197: Calls `/api/admin/wattbuy/ping`
   - Line 211: Calls `/api/admin/wattbuy/offers`
   - Line 233: Calls `/api/admin/debug/smt/raw-files`
   - **Status**: Manual execution only, not scheduled

2. **`scripts/admin/Invoke-Intelliwatt.ps1`**
   - Purpose: Wrapper script for admin API calls
   - Line 8: Requires `$env:ADMIN_TOKEN` in PowerShell session
   - Line 11: Automatically injects `x-admin-token` header
   - **Status**: Helper script, not automated

**No Evidence Found For**:
- Systemd timers (`/etc/systemd`, `systemd` references)
- Cron job files (`@daily`, `@hourly` patterns)
- Automated droplet scripts that curl admin routes
- `CRON_SECRET` environment variable or authentication

### Authentication Patterns

**Admin Endpoints**:
- Use `requireAdmin()` from `lib/auth/admin.ts`
- Require `x-admin-token` header matching `ADMIN_TOKEN` env var
- **Cron routes do NOT use this pattern**

**Cron Endpoints**:
- No authentication checks detected
- Rely on Vercel's internal routing (cron requests come from Vercel infrastructure)
- **Security Note**: These endpoints are publicly accessible via POST if URL is known

## Environment Variables

### Required for Cron Jobs
- `WATTBUY_API_KEY` - Required by `/api/admin/rates/refresh` (line 22 comment)

### Required for Admin Scripts
- `ADMIN_TOKEN` - Used by manual scripts and admin endpoints
  - Set in PowerShell session: `$env:ADMIN_TOKEN = '<token>'`
  - Never committed to repository

### Not Found
- `CRON_SECRET` - Not used in codebase
- `VERCEL_CRON_SECRET` - Not used in codebase

## Next Steps

### To Verify Cron Jobs Are Running

1. **Check Vercel Dashboard**:
   - Navigate to: https://vercel.com/dashboard
   - Go to project → Settings → Cron Jobs
   - Verify both jobs are listed and show recent execution history

2. **Monitor Logs**:
   - Check Vercel function logs for `/api/admin/rates/refresh` at ~2:00 AM UTC
   - Check Vercel function logs for `/api/rates/efl-refresh` at ~3:00 AM UTC
   - Look for execution traces and any errors

3. **Manual Testing**:
   ```powershell
   # Test rates refresh (requires WATTBUY_API_KEY in Vercel env)
   Invoke-RestMethod -Uri "https://intelliwatt.com/api/admin/rates/refresh" -Method POST
   
   # Test EFL refresh
   Invoke-RestMethod -Uri "https://intelliwatt.com/api/rates/efl-refresh" -Method POST
   ```

### Security Recommendations

**Current State**: Cron routes are publicly accessible via POST if URL is known.

**Recommended Improvements**:

1. **Add Vercel Cron Authentication**:
   - Check for `x-vercel-cron` header (automatically added by Vercel)
   - Example:
     ```typescript
     const cronHeader = req.headers.get('x-vercel-cron');
     if (!cronHeader) {
       return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
     }
     ```

2. **Alternative: Add CRON_SECRET**:
   - Set `CRON_SECRET` in Vercel environment variables
   - Add custom header in `vercel.json` cron config
   - Verify header in route handlers

3. **Consider Admin Gate for `/api/admin/rates/refresh`**:
   - Since it's under `/api/admin/*`, consider adding `requireAdmin()` check
   - Or move to non-admin path if it should be cron-only

### To Add New Scheduled Jobs

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
   - Add authentication check (see recommendations above)
   - Deploy to trigger Vercel cron registration

3. **Verify**:
   - Check Vercel dashboard for new cron job
   - Monitor logs after first scheduled run

## Related Documentation

- `docs/ADMIN_API.md` - Admin endpoint authentication patterns
- `docs/QUICK_START.md` - Quick reference for environment setup
- `scripts/admin/Invoke-Intelliwatt.ps1` - Admin API wrapper script

