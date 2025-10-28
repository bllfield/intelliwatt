# IntelliWatt Project Context

**Purpose**: This document provides operational context for the IntelliWatt project, including current deployment state, database information, and development guidelines for AI chat sessions.

**Last Updated**: January 2025

---

## Environment & Deployment

### Production Infrastructure
- **Deployment**: https://intelliwatt.com (Vercel)
- **Database**: DigitalOcean PostgreSQL (production)
- **CMS**: Connected to DigitalOcean managed database
- **Build System**: Next.js 14+ with App Router

### Infrastructure
- **Droplet**: DigitalOcean droplet for backend processing
- **Database**: DigitalOcean managed PostgreSQL cluster
- **Hosting**: Vercel for frontend/API deployment
- **CDN**: Vercel Edge Network for static assets
- **Monitoring**: Integrated with Vercel Analytics

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
- **Model**: `HouseAddress` (in `prisma/schema.prisma`)
- **Validation Source**: Enum values (NONE, GOOGLE, USER, OTHER)
- **Indexes**: userId, placeId, addressState+addressZip5, esiid

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

#### Data Endpoints
- `POST https://intelliwatt.com/api/address/save` - Save/update address
- `GET https://intelliwatt.com/api/v1/houses/{id}/profile` - Get house profile

---

## Feature Implementation Details

### Address Collection System
- **Component**: `components/QuickAddressEntry.tsx`
- **Integration**: Google Places Autocomplete with manual fallback
- **Storage**: `HouseAddress` model in database
- **Normalization**: Google → normalized via `lib/normalizeGoogleAddress.ts`
- **Consent**: Smart Meter consent checkbox integrated

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

### Planned Features
- Add WattBuy integration to fetch ESIID after save
- Add database indexes and accelerate connection pooling
- Allow multiple addresses per user (add houseId field)
- Add validation/geocoding with retries

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

- **Environment Variable**: `DATABASE_URL` (DigitalOcean connection string)
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

## Security Updates (Brief)

- **Oct 2025:** Introduced `ADMIN_TOKEN` gating for `/api/debug/*`, `/api/migrate`, and `/api/admin/*`. Production requires the token; Preview/Dev requires it only if set.

