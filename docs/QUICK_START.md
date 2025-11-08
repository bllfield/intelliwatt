# IntelliWatt Quick Start

**One-page reference for new chat sessions**

---

## ⚠️ CRITICAL: Windows PowerShell Environment

**DO NOT use bash-style `&&` chaining**
```powershell
# ❌ WRONG
git add . && git commit -m "message"

# ✅ CORRECT
git add .; git commit -m "message"
```

---

## 🚀 Production Access

- **URL**: https://intelliwatt.com (Vercel)
- **Database**: DigitalOcean PostgreSQL (production)
- **API**: Prefer **Preview** deployments for testing; treat **Production** as read-only for verified flows
- **No local dev server** needed for data queries

### Environment Strategy
- **Preview**: Use for all testing, development, and experimental changes
- **Production**: Read-only for verified flows and data queries only
- **Safety**: Avoid modifying production data during development

---

## 📊 Current Database State

**3 addresses** (1 per user):

1. `bllfield@yahoo.com` → 9514 Santa Paula Drive, Fort Worth, TX 76116
2. `brian@intellipath-solutions.com` → 8808 Las Vegas Court, Fort Worth, TX 76108
3. `bllfield32@gmail.com` → 1860 East Northside Drive (Unit 2223), Fort Worth, TX 76106

---

## 🔧 Quick Commands (PowerShell)

### Admin Authentication Required
All debug/admin endpoints now require `x-admin-token` header matching `ADMIN_TOKEN` env var.

```powershell
$headers = @{ "x-admin-token" = "<YOUR_ADMIN_TOKEN>" }
```

### Check All Addresses

**Preview (Recommended for Testing):**
```powershell
# Replace <your-preview> with your Vercel preview deployment URL
$headers = @{ "x-admin-token" = "<YOUR_ADMIN_TOKEN>" }
Invoke-RestMethod -Headers $headers -Uri "https://<your-preview>.vercel.app/api/debug/list-all-addresses" -Method GET
```

**Production (Read-Only):**
```powershell
$headers = @{ "x-admin-token" = "<YOUR_ADMIN_TOKEN>" }
Invoke-RestMethod -Headers $headers -Uri "https://intelliwatt.com/api/debug/list-all-addresses" -Method GET
```

### Check Specific User

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

### Cleanup Duplicates

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

## 📁 Key Files

- **Prisma Client**: `lib/db.ts`
- **Address Save**: `app/api/address/save/route.ts`
- **Address Normalization**: `lib/normalizeGoogleAddress.ts`
- **Autocomplete UI**: `components/QuickAddressEntry.tsx`
- **Database Schema**: `prisma/schema.prisma`

---

## 🔗 API Endpoints

- `GET /api/debug/list-all-addresses`
- `GET /api/debug/check-address?email=...`
- `POST /api/debug/cleanup`
- `POST /api/address/save`

---

## 📚 Full Documentation

- **[PROJECT_CONTEXT.md](./PROJECT_CONTEXT.md)** - Complete operational context
- **[GOOGLE_MAPS_SETUP.md](./GOOGLE_MAPS_SETUP.md)** - Maps integration
- **[ARCHITECTURE_STANDARDS.md](./ARCHITECTURE_STANDARDS.md)** - Core principles
- **[PROJECT_PLAN.md](./PROJECT_PLAN.md)** - Project guardrails

---

**Last Updated**: January 2025

### Verify WattBuy offers (no ESIID) and DB persistence

1) Run the probe + public offers smoke (bash):

```bash
ADMIN_TOKEN="<ADMIN_TOKEN>" BASE_URL="https://intelliwatt.com" ZIP5="76107" scripts/admin/wattbuy_offers_smoke.sh
```

