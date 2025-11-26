## Customer Flow: IntelliWatt Plan Analyzer

1. **Address Capture**
   - User provides service address (with optional bill upload for prefill).
   - System resolves TDSP/utility, ESIID, and meter metadata.
2. **SMT API Authorization**
   - User consents to Smart Meter Texas access (~12 months).
   - Backend triggers agreement/subscription and begins pulling usage/billing.
3. **Usage Normalization**
   - Normalize SMT interval/billing (or alternate sources) into canonical usage for the last 12 months.
4. **Current Rate Details (Optional, +1 Entry)**
   - Screen title: “Current Rate Details — Add your current plan info for a more detailed comparison.”
   - Paths:
     - **Upload your bill** (photo/image/PDF) for future OCR extraction.
     - **Enter manually** (plan name, primary rate, base fee, contract expiration, notes).
   - Copy explicitly states:
     - Step is optional; skipping still yields usage-based recommendations.
     - Completing it shows how current contract costs compare against IntelliWatt recommendations and projected renewal costs.
    - Completing grants **+1 HitTheJackWatt jackpot entry.**
5. **Rate Plan Analyzer Output**
   - Recommend plans based on real usage.
   - When Current Rate Details are provided, include “current vs recommended vs renewal” cost comparisons.
6. **Home Details**
7. **Appliances**
8. **Upgrades**
9. **Optimal Energy (future)**
# IntelliWatt Project Context

**Purpose**: This document provides operational context for the IntelliWatt project, including current deployment state, database information, and development guidelines for AI chat sessions.

**Last Updated**: January 2025

---

## How We Build & Deploy (Read First)

- Coding happens in Cursor using single, copy-ready GPT blocks with explicit file targets and surgical edits.

- Production deploys happen via Git; pushing to `main` triggers Vercel Production builds automatically.

- The DigitalOcean droplet is only for Smart Meter Texas (SMT) SFTP/ingestion—not web-app deploys.

- Avoid `&&` in command examples; keep one command per line.

**Authoritative docs:**

- Workflow overview: `docs/QUICK_START.md` (Development & Deploy Workflow)

- GPT/Cursor collaboration rules: `docs/GPT_COLLAB.md`

- System-wide expectations: `docs/ARCHITECTURE_STANDARDS.md` (Operational Standards, Auth Standards, Health/Debug)

- ERCOT daily pull system: `docs/DEPLOY_ERCOT.md` (complete guide including migration, deployment, and troubleshooting)

## Where To Start

1. Open `docs/QUICK_START.md` and follow the workflow steps.

2. Use Cursor to apply changes via single GPT blocks.

3. Push to `main` to deploy and verify with `/api/admin/env-health`.

---

## Environment & Deployment

### Production Infrastructure
- **Deployment**: https://intelliwatt.com (Vercel)
- **Database**: DigitalOcean PostgreSQL (production)
- **CMS**: Connected to DigitalOcean managed database
- **Build System**: Next.js 14+ with App Router

### Infrastructure
- **Database**: DigitalOcean managed PostgreSQL cluster
- **Hosting**: Vercel for frontend/API deployment
- **CDN**: Vercel Edge Network for static assets
- **Monitoring**: Integrated with Vercel Analytics

#### Infrastructure (SMT Proxy)
- **Droplet**: DigitalOcean — `intelliwatt-smt-proxy`
- **IP**: `64.225.25.54`
- **OS/User**: Ubuntu 22.04+, user `deploy`
- **Purpose**: Pull SMT files (SFTP), post RAW files to IntelliWatt API
- **Key Path**: `/home/deploy/.ssh/intelliwatt_smt_rsa4096` (private), `.pub` uploaded to SMT

### Environment Strategy
⚠️ **CRITICAL**: Use Preview deployments for testing, treat Production as read-only

- **Preview Deployments**: For all testing, development, and experimental changes
  - Every branch/PR gets a unique preview URL
  - Safe to test data modifications
  - Connected to same production database (use with caution)
  
- **Production**: Read-only for verified flows and data queries
  - Only use for querying existing data
  - Avoid running cleanup or modification endpoints
  - Verified flows only

### Development Guidelines
⚠️ **IMPORTANT**: Do not attempt to start a local dev server or query the database directly during development.

- Production data is available via deployed API endpoints
- **Prefer Preview deployments** for all testing and debugging
- Use Production API only for read-only verified flows
- No local database connection needed
- Migration scripts have been applied

**Security note (Oct 2025):** Admin/Debug routes are now gated with `ADMIN_TOKEN`.
- **Production:** `ADMIN_TOKEN` is required; requests must include header `x-admin-token`.
- **Preview/Dev:** If `ADMIN_TOKEN` is set, it is required; if it is **not** set, access is allowed to prevent lockout.
- See **ENV_VARS.md → ADMIN_TOKEN** for details and usage examples.
- **Admin/debug calls:** Use the wrapper `scripts/admin/Invoke-Intelliwatt.ps1` so requests automatically include `x-admin-token`. See **docs/ADMIN_API.md**.

---


### Database Schema
- **Models**: 
  - `HouseAddress` (in `prisma/schema.prisma`) - Address collection with ESIID (conflict handling now transfers meters to the newest user and preserves raw vendor payloads). As of Nov 19, 2025 we also mirror the normalized `userEmail` alongside the cuid `userId` so ops can search by email even if the login address changes.
  - `UserProfile` - Stores household metadata and now tracks ESIID attention flags (`esiidAttentionRequired`, `esiidAttentionCode`, `esiidAttentionAt`) so Customer Ops can email prior owners when a meter moves. The address save endpoint now emits a warning (instead of crashing) if those columns are still missing, reminding ops to run `npx prisma migrate deploy`.
  - `ErcotIngest` - ERCOT file ingestion history tracking
  - `ErcotEsiidIndex` - Normalized ESIID data from ERCOT extracts
  - `RatePlan` - Normalized electricity plans (REP plans and utility tariffs)
  - `RawSmtFile` - Raw SMT file storage
  - `SmtInterval` - SMT usage interval data
- **Validation Source**: Enum values (NONE, GOOGLE, USER, OTHER)
- **Indexes**: userId, placeId, addressState+addressZip5, esiid
- **ERCOT Indexes**: normZip, normLine1 (GIN trigram for fuzzy matching)

---

## Windows Environment Notes

### Shell Configuration
- **Shell**: Windows PowerShell
- **Location**: `C:\WINDOWS\System32\WindowsPowerShell\v1.0\powershell.exe`

### Command Syntax Requirements
⚠️ **CRITICAL**: Never use bash-style command chaining

❌ **DO NOT USE**:
```bash
git add . && git commit -m "message" && git push
```

✅ **USE INSTEAD**:
```powershell
git add .; git commit -m "message"; git push
```

Or use separate commands:
```powershell
git add .
git commit -m "message"
git push
```

### Example Production API Commands
```powershell
# Admin token required for all debug endpoints
$headers = @{ "x-admin-token" = "<ADMIN_TOKEN>" }

# PowerShell syntax for API calls
Invoke-RestMethod -Headers $headers -Uri "https://intelliwatt.com/api/debug/list-all-addresses" -Method GET

# Parse JSON response
$data = Invoke-RestMethod -Headers $headers -Uri "https://intelliwatt.com/api/debug/list-all-addresses" -Method GET

# Check specific address
Invoke-RestMethod -Headers $headers -Uri "https://intelliwatt.com/api/debug/check-address?email=bllfield@yahoo.com" -Method GET
```

---

## Architecture Overview

### Project Structure
```
app/                     # App Router (Next.js 14+)
├── api/                # API routes
│   ├── admin/          # Admin endpoints
│   ├── debug/          # Debug utilities
│   └── address/        # Address management
lib/                     # Core libraries
├── db.ts               # Prisma client
├── normalizeGoogleAddress.ts  # Address normalization
└── wattbuy/           # WattBuy integration
prisma/                 # Database schema
├── schema.prisma       # Prisma models
└── migrations/         # Migration history
components/             # React components
├── QuickAddressEntry.tsx  # Google autocomplete
└── plan/              # Plan-related components
```

### Key Files
- **Prisma Client**: `lib/db.ts` (import as `import { prisma } from '@/lib/db'`)
- **Address Save**: `app/api/address/save/route.ts` (upsert logic)
- **Normalization**: `lib/normalizeGoogleAddress.ts`
- **Google Setup**: `docs/GOOGLE_MAPS_SETUP.md`

### API Endpoints

#### Debug/Utility Endpoints (admin-gated)
> ⚠️ These endpoints now require header `x-admin-token: <ADMIN_TOKEN>`.  
> Prefer **Preview** for testing; treat **Production** as read-only for verified flows.

- `GET https://intelliwatt.com/api/debug/list-all-addresses` - List all addresses
- `GET https://intelliwatt.com/api/debug/check-address?email=...` - Check specific user
- `POST https://intelliwatt.com/api/debug/cleanup` - Remove duplicates
- `GET https://intelliwatt.com/api/migrate` - Run migrations
- `GET https://intelliwatt.com/api/admin/env-health` - Check environment variable status

#### WattBuy Admin Endpoints (admin-gated)
- `GET /api/admin/wattbuy/retail-rates-test` - Test retail rates (utilityID+state OR address auto-derive)
- `GET /api/admin/wattbuy/retail-rates-zip` - Retail rates by ZIP (auto-derives utilityID)
- `GET /api/admin/wattbuy/retail-rates-by-address` - Retail rates by address (convenience)
- `GET /api/admin/wattbuy/retail-rates` - Main retail rates endpoint (with DB persistence)
- `GET /api/admin/wattbuy/electricity` - Robust electricity catalog (with fallback)
- `GET /api/admin/wattbuy/electricity-probe` - Electricity probe endpoint
- `GET /api/admin/wattbuy/electricity/info` - Electricity info endpoint

#### ERCOT Admin Endpoints (admin-gated)
- `GET /api/admin/ercot/cron` - Vercel cron endpoint (header `x-cron-secret` or query `?token=CRON_SECRET`)
- `GET /api/admin/ercot/fetch-latest` - Manual fetch by explicit URL
- `GET /api/admin/ercot/ingests` - List ingestion history
- `GET /api/admin/ercot/debug/last` - Get last ingest record
- `GET /api/admin/ercot/debug/url-sanity` - Test URL resolution
- `POST /api/admin/ercot/lookup-esiid` - Lookup ESIID from address using ERCOT data

#### SMT Admin Endpoints (admin-gated)
- `POST /api/admin/smt/pull` - Trigger SMT data pull via webhook
- `POST /api/admin/smt/ingest` - SMT file ingestion
- `POST /api/admin/smt/upload` - SMT file upload
- `GET /api/admin/smt/health` - SMT health check

#### Data Endpoints
- `POST https://intelliwatt.com/api/address/save` - Save/update address
- `GET https://intelliwatt.com/api/v1/houses/{id}/profile` - Get house profile

#### Public Endpoints
- `GET /api/ping` - Health check (JSON)
- `GET /api/ping.txt` - Health check (plain text)

---

## Feature Implementation Details

### Address Collection System
- **Component**: `components/QuickAddressEntry.tsx`
- **Integration**: Google Places Autocomplete with manual fallback
- **Storage**: `HouseAddress` model in database
- **Normalization**: Google → normalized via `lib/normalizeGoogleAddress.ts`
- **Consent**: Smart Meter consent checkbox integrated
- **Email Normalization**: All emails normalized to lowercase via `lib/utils/email.ts` to prevent duplicate accounts

### Google Maps Setup
- **API Key**: `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` (env var)
- **Script**: Loaded in `app/layout.tsx`
- **Autocomplete**: Reads full place details
- **Fallback**: Manual entry parsing via `lib/parseManualAddress.ts`

### Address Save Flow
1. User enters address (autocomplete or manual)
2. Optional unit/apartment number entry
3. Smart Meter consent checkbox
4. POST to `/api/address/save` with normalized fields
5. Upsert logic finds existing userId, updates; else creates

---

## Known Issues & Limitations

### Performance
- **Vercel Cold Starts**: 20 seconds to 2 minutes latency on first request
- **Database Latency**: Network latency (not Prisma issues)
- **Query Delays**: Connection pooling may cause delays

### Autocomplete
- Autocomplete may not initialize properly
- Falls back to manual entry gracefully
- Google API key restrictions configured

---

## Next Steps & Considerations

### Recent Features Implemented
- ✅ ERCOT daily pull system for ESIID data ingestion
- ✅ WattBuy retail rates and electricity catalog integration
- ✅ Email normalization to prevent duplicate accounts
- ✅ SMT integration with webhook triggers
- ✅ Admin inspector UIs for WattBuy, SMT, and ERCOT
- ✅ Robust electricity endpoint with fallback strategies
- ✅ Rate plan normalization and database persistence

### Planned Features
- Add database indexes and accelerate connection pooling
- Allow multiple addresses per user (add houseId field)
- Add validation/geocoding with retries
- Complete ERCOT file URL resolution (currently manual)

### Optimization Opportunities
- Implement caching strategies
- Accelerate Vercel cold starts
- Optimize database connection pool
- Add retry logic for external APIs

---

## Important Files Reference

### Database & Schema
- `prisma/schema.prisma` - Database models and enums
- `lib/db.ts` - Prisma client setup

### Address Management
- `app/api/address/save/route.ts` - Address save/update logic
- `lib/normalizeGoogleAddress.ts` - Google to normalized address mapping
- `components/QuickAddressEntry.tsx` - Autocomplete UI component

### Configuration
- `app/layout.tsx` - Google Maps script loading
- `middleware.ts` - Request middleware
- `lib/flags/index.ts` - Feature flags

### Documentation
- `docs/GOOGLE_MAPS_SETUP.md` - Google Maps integration guide
- `docs/ARCHITECTURE_STANDARDS.md` - Core architecture principles
- `docs/PROJECT_PLAN.md` - Authoritative project plan
- `docs/API_CONTRACTS.md` - API versioning and contracts
- `docs/ENV_VARS.md` - Environment variables
- `docs/OBSERVABILITY.md` - Logging and monitoring
- `docs/STANDARDS_COMPONENTS.md` - Component-specific standards

---

## Quick Commands Reference

### Admin Authentication Required
All debug/admin endpoints now require `x-admin-token` header matching `ADMIN_TOKEN` env var.

```powershell
$headers = @{ "x-admin-token" = "<YOUR_ADMIN_TOKEN>" }
```

### Check Current Addresses (PowerShell)

**Preview (Recommended):**
```powershell
# Replace <your-preview> with your Vercel preview deployment URL
$headers = @{ "x-admin-token" = "<YOUR_ADMIN_TOKEN>" }
$response = Invoke-RestMethod -Headers $headers -Uri "https://<your-preview>.vercel.app/api/debug/list-all-addresses" -Method GET
$response.recentAddresses
```

**Production (Read-Only):**
```powershell
$headers = @{ "x-admin-token" = "<YOUR_ADMIN_TOKEN>" }
$response = Invoke-RestMethod -Headers $headers -Uri "https://intelliwatt.com/api/debug/list-all-addresses" -Method GET
$response.recentAddresses
```

### Check User Address (PowerShell)

**Preview:**
```powershell
$headers = @{ "x-admin-token" = "<YOUR_ADMIN_TOKEN>" }
Invoke-RestMethod -Headers $headers -Uri "https://<your-preview>.vercel.app/api/debug/check-address?email=bllfield@yahoo.com" -Method GET
```

**Production:**
```powershell
$headers = @{ "x-admin-token" = "<YOUR_ADMIN_TOKEN>" }
Invoke-RestMethod -Headers $headers -Uri "https://intelliwatt.com/api/debug/check-address?email=bllfield@yahoo.com" -Method GET
```

### Run Cleanup (PowerShell)

⚠️ **Use Preview only - avoid running on Production**
```powershell
$headers = @{ "x-admin-token" = "<YOUR_ADMIN_TOKEN>" }
Invoke-RestMethod -Headers $headers -Uri "https://<your-preview>.vercel.app/api/debug/cleanup" -Method POST
```

### Check Environment Health

**Preview:**
```powershell
$headers = @{ "x-admin-token" = "<YOUR_ADMIN_TOKEN>" }
Invoke-RestMethod -Headers $headers -Uri "https://<your-preview>.vercel.app/api/admin/env-health" -Method GET
```

**Production:**
```powershell
$headers = @{ "x-admin-token" = "<YOUR_ADMIN_TOKEN>" }
Invoke-RestMethod -Headers $headers -Uri "https://intelliwatt.com/api/admin/env-health" -Method GET
```

---

## Database Connection

- **Primary Runtime URL (`DATABASE_URL`)**
  - Must point at the DigitalOcean PgBouncer pool on port `25061`.
  - Example (replace the password with the current value from DO):
    ```
    postgresql://doadmin:AVNS_lUXcN2ftFFu6XUIc5G0@db-postgresql-nyc3-37693-do-user-27496845-0.k.db.ondigitalocean.com:25061/app-pool?sslmode=require&pgbouncer=true
    ```
  - This URL is required in **all** environments: local `.env`, `.env.production.local`, Vercel env vars, and the droplet.

- **Direct URL for Prisma (`DIRECT_URL`)**
  - Used only by `prisma migrate` / `prisma db execute`.
  - Same credentials, but port `25060` and no `pgbouncer=true`:
    ```
    postgresql://doadmin:AVNS_lUXcN2ftFFu6XUIc5G0@db-postgresql-nyc3-37693-do-user-27496845-0.k.db.ondigitalocean.com:25060/defaultdb?sslmode=require
    ```
  - Keep this alongside `DATABASE_URL` in every `.env` so Prisma can read both.

- **Droplet update (run exactly as written when connected as `root`)**
  ```bash
  sudo nano /etc/environment
  ```
  Paste the two lines below at the end of the file, then save (`Ctrl+O`, Enter) and exit (`Ctrl+X`):
  ```dotenv
  DATABASE_URL="postgresql://doadmin:AVNS_lUXcN2ftFFu6XUIc5G0@db-postgresql-nyc3-37693-do-user-27496845-0.k.db.ondigitalocean.com:25061/app-pool?sslmode=require&pgbouncer=true"
  DIRECT_URL="postgresql://doadmin:AVNS_lUXcN2ftFFu6XUIc5G0@db-postgresql-nyc3-37693-do-user-27496845-0.k.db.ondigitalocean.com:25060/defaultdb?sslmode=require"
  ```
  Reload the session so the env vars are active:
  ```bash
  source /etc/environment
  ```
  Restart any services or scripts after updating.

- **Prisma Studio**
  - Uses whichever value `DATABASE_URL` currently holds.
  - Always close Studio (`Ctrl+C`) when finished so pooled connections are released.

- **Migration Status**: Applied (HouseAddress model exists)
- **Client Import**: `import { prisma } from '@/lib/db'`

---

## Related Documentation

For detailed information about specific areas, see:
- **[Google Maps Setup](./GOOGLE_MAPS_SETUP.md)** - Google Places API configuration
- **[Architecture Standards](./ARCHITECTURE_STANDARDS.md)** - Core principles and patterns
- **[Project Plan](./PROJECT_PLAN.md)** - Authoritative project guardrails
- **[API Contracts](./API_CONTRACTS.md)** - API versioning strategy
- **[Environment Variables](./ENV_VARS.md)** - Required env vars
- **[Observability](./OBSERVABILITY.md)** - Logging and monitoring
- **[Component Standards](./STANDARDS_COMPONENTS.md)** - Component implementations

---

## Company Identity Snapshot (CSP / SMT)

This snapshot is canonical for SMT, PUCT, and CSP-related integrations.

- Legal Name: Intellipath Solutions LLC
- DBA: IntelliWatt
- DUNS: 134642921
- PUCT Aggregator Registration Number: 80514
- Official Business Phone (for PUCT / SMT / CSP matters): 817-471-0579
- Primary Business Email: brian.littlefield@intellipath-solutions.com

Smart Meter Texas Integration Context:

- CSP identity: Intellipath Solutions LLC / DBA IntelliWatt
- Current usage:
  - WattBuy is the active ESIID source of truth.
  - SMT SFTP + API handle customer-authorized interval data (Agreements / Subscriptions / Enrollment).
- Support contacts in practice:
  - Primary SMT support: support@smartmetertexas.com
  - SMT service desk (tickets): rt-smartmeterservicedesk@randstadusa.com

All CSP documentation, SMT tickets, and API requests must reference these identifiers unless superseded by a future LOCKED plan entry.

---

## Security Updates (Brief)

- **Oct 2025:** Introduced `ADMIN_TOKEN` gating for `/api/debug/*`, `/api/migrate`, and `/api/admin/*`. Production requires the token; Preview/Dev requires it only if set.

