# ERCOT Database Migration Guide

## Overview

After adding the ERCOT models (`ErcotIngest` and `ErcotEsiidIndex`) to the Prisma schema, you need to run a database migration to create these tables.

## Prerequisites

1. **Database URL configured**: Set `DATABASE_URL` in your environment or `.env.local`
2. **Prisma CLI installed**: `npm install` should have installed it
3. **Database access**: Ensure you can connect to your database

## Migration Steps

### For Development

```bash
npx prisma migrate dev --name add_ercot_models
```

This will:
- Create a new migration file
- Apply it to your development database
- Regenerate Prisma Client

### For Production

```bash
npx prisma migrate deploy
```

This will:
- Apply all pending migrations to production
- **Does NOT** create new migration files (use `migrate dev` for that)
- Safe to run multiple times (idempotent)

## Verify Migration

After running the migration, verify the tables were created:

```bash
npx prisma studio
```

Or check via SQL:

```sql
SELECT table_name 
FROM information_schema.tables 
WHERE table_schema = 'public' 
  AND table_name IN ('ErcotIngest', 'ErcotEsiidIndex');
```

## Expected Tables

After migration, you should have:

1. **ErcotIngest** - Tracks ingestion history
   - `id`, `createdAt`, `updatedAt`
   - `fileHash`, `sourceUrl`
   - `startedAt`, `finishedAt`
   - `status`, `recordsSeen`, `recordsUpserted`, `errorMessage`

2. **ErcotEsiidIndex** - Stores ESIID data
   - `id`, `createdAt`, `updatedAt`
   - `esiid` (unique)
   - `meterNumber`, `serviceAddress1`, `serviceAddress2`
   - `city`, `state`, `zip`, `county`
   - `premiseType`, `status`
   - `tdspName`, `tdspCode`, `utilityName`, `utilityId`
   - `raw` (JSON)

## Troubleshooting

### Error: "Environment variable not found: DATABASE_URL"

Set `DATABASE_URL` in your `.env.local` file:
```
DATABASE_URL="postgresql://user:password@host:port/database"
```

### Error: "Migration failed"

- Check database connection
- Ensure you have write permissions
- Review migration SQL in `prisma/migrations/` folder

### Rollback (if needed)

```bash
npx prisma migrate resolve --rolled-back <migration_name>
```

## Next Steps

After migration:
1. Configure `ERCOT_PAGE_URL` environment variable
2. Test the cron endpoint: `GET /api/admin/ercot/cron?token=<CRON_SECRET>`
3. Verify data ingestion in the admin UI

