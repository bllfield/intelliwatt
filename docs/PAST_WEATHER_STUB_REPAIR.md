# Past Weather Stub Repair

## When to use

- The Past page shows **“Weather basis: mixed actual + stub weather data”** for a house.
- An audit (e.g. querying `HouseDailyWeather` for the house and canonical date range) shows **STUB_V1** on dates where adjacent days have **OPEN_METEO_CACHE** (or other real source).
- Real weather was (or is now) available from the API for those dates; the stub rows were left in place because the previous backfill logic never replaced existing rows.

## Root cause (one sentence)

Backfill only fetched for dates with **no** row; the repo used insert-only (`createMany`, `skipDuplicates`), so existing STUB_V1 rows were never overwritten when the API later returned actual data.

## Fix (one sentence)

Backfill now fetches for dates that are missing **or** have only a STUB_V1 row, deletes those stub rows for dates where actual data is received, then inserts the actual rows. Real rows are never deleted or overwritten with stubs.

## Repair procedure

### Option 1: Script (recommended)

From the project root, with env (e.g. `.env.local`) loaded so the app can reach the DB:

```bash
npx ts-node scripts/repair-past-weather-stubs.ts <houseId> [--start=YYYY-MM-DD] [--end=YYYY-MM-DD]
```

- **houseId** (required): The house UUID, e.g. `8a6fe8b9-601e-4f9d-aa3e-7ef0b4bddde8`.
- **--start=** / **--end=** (optional): Date range to consider. If omitted, the script uses the last 366 days from today (UTC).

The script:

1. Finds ACTUAL_LAST_YEAR rows with `source = 'STUB_V1'` in the range.
2. Deletes only those stub rows.
3. Runs `ensureHouseWeatherBackfill` for the same house and range so the API is called and actual rows are inserted where available.
4. Prints `deleted`, `fetched`, and `stubbed` counts.

Safe to rerun. It never deletes or overwrites real weather rows.

### Option 2: One-time SQL then backfill

If you prefer to repair via SQL and then trigger backfill (e.g. via Past page load or simulator):

```sql
DELETE FROM "HouseDailyWeather"
WHERE "houseId" = '<houseId>'
  AND "kind" = 'ACTUAL_LAST_YEAR'
  AND "source" = 'STUB_V1'
  AND "dateKey" >= '<startDate>'
  AND "dateKey" <= '<endDate>';
```

Then run backfill for that house/range (e.g. open the Past page for the house so `ensureHouseWeatherBackfill` runs, or run the repair script with the same range so it only does the backfill step after the delete).

## Verification

1. **DB:** For the house and the repaired date range, query `HouseDailyWeather` for `kind = 'ACTUAL_LAST_YEAR'` and confirm that dates that previously had STUB_V1 now have `source = 'OPEN_METEO_CACHE'` (or another non-stub value) when the API returned data.
2. **Past page:** Reload the Past view for the house. If no ACTUAL_LAST_YEAR stub rows remain in the canonical window, the weather basis should show **actual only** (or equivalent). If some dates still have no data from the API, “mixed” or “stub only” may still appear for those; that is expected.

## References

- **Provenance rule and stale-stub fix:** `docs/PAST_WEATHER_PROVENANCE_AUDIT.md`
- **Backfill and repair implementation:** `modules/weather/backfill.ts`, `modules/weather/repo.ts`
- **Boundary-date audit (diagnosis):** `docs/PAST_WEATHER_ROW_AUDIT_PLAN.md`
