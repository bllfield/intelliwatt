# Usage interval ingest audit (Green Button + SMT)

**Goal:** One repair/normalize/TZ pass at ingest; one DB shape; all downstream surfaces read persisted rows without re-repair.

## Green Button — owners (after 2026-05 unification)

| Concern | Module | Notes |
|---------|--------|--------|
| Parse + normalize + overlap + vendor slot repair | `lib/usage/greenButtonUsagePipeline.ts` → `normalizeGreenButtonReadingsTo15Min` | Only ingest |
| Overlap allocation (straddle-safe) | `lib/usage/greenButtonHomeLocalBuckets.ts` | Called from normalize |
| Vendor gap repair (/2, /3) | `lib/usage/greenButtonSlotRepair.ts` | Called from normalize only |
| 365-day trim | `lib/usage/greenButtonCoverage.ts` | After normalize |
| Ingest version stamp | `lib/usage/greenButtonIngestContract.ts` | `intervalIngestVersion` in upload `parseMessage` JSON |
| Persist | `GreenButtonInterval` via app upload or Droplet | Rows = canonical 15-min Chicago slot starts (UTC wall clock) |
| Read (no repair) | `lib/usage/loadPersistedGreenButtonIntervals.ts` | Project via `convertGreenButtonPersistedRowsToHome` |
| Usage dataset + range fetch | `lib/usage/actualDatasetForHouse.ts` | Uses loader only |
| Re-upload / backfill | `lib/usage/rehydrateGreenButtonIntervalsFromRaw.ts` | Re-runs pipeline from `rawGreenButton.content` |

### Ingest entry points (must use pipeline)

| Entry | Status |
|-------|--------|
| `app/api/green-button/upload/route.ts` | Uses `runGreenButtonUsagePipeline` |
| `scripts/droplet/green-button-upload-server.ts` | Uses `runGreenButtonUsagePipeline` (no local normalize fork) |

### Downstream readers (must use persisted rows)

| Consumer | Read path |
|----------|-----------|
| Usage dashboard / `getActualUsageDatasetForHouse` | `loadPersistedGreenButtonIntervalsForWindow` |
| Past sim producer | `getActualIntervalsForRangeWithSource` → same loader |
| Gap-fill / preload | `getActualIntervalsForRange` |
| Plan monthly buckets | `ensureCoreMonthlyBuckets` → `greenButtonInterval.findMany` (rows already repaired at ingest) |
| Usage shape profile | `getActualIntervalsForRangeWithSource` |

### Not unified (separate concerns — do not re-normalize base intervals)

| Module | Role |
|--------|------|
| `modules/realUsageAdapter/greenButton.ts` | Year-shift / trusted-pool for trailing Past days; reads DB then applies **shift** rules (90-slot GB trust). Not a second normalize. Per SMT lock: do not change for coverage fixes without explicit scope. |
| Cached Past artifacts | Snapshot; invalidate on re-upload / fingerprint change |
| `modules/onePathSim/greenButtonIntervalCorrections.ts` | Legacy UTC grid zero redistribution; prefer phasing out in favor of ingest-trusted rows |

### Stale data

Houses uploaded before `intervalIngestVersion: 1` may have pre-repair intervals in DB.

- **Fix:** `rehydrateGreenButtonIntervalsFromRawForHouse({ houseId })` or re-upload on Droplet.
- **Detect:** `isGreenButtonIntervalIngestCurrent(upload.parseMessage)` from `greenButtonIngestContract.ts`.
- **Gate (wired):** `resolveGreenButtonIntervalIngestReadiness` — sim/plans/Usage/adapter reads return empty until `intervalIngestVersion` matches; see `lib/usage/greenButtonIntervalReadiness.ts`.

## SMT — owners (existing)

| Concern | Module |
|---------|--------|
| Normalize to 15-min | `lib/analysis/normalizeSmt.ts`, `app/lib/smt/normalize.ts` |
| Persist | `lib/usage/normalizeSmtIntervals.ts` (`normalizeAndPersistSmtIntervals`, `replaceNormalizedSmtIntervals`) |
| Read (project only) | `lib/time/smtPersistedIntervalConvert.ts` → `convertSmtPersistedRowsToHome` |
| Range fetch | `getActualIntervalsForRangeWithSource` (SMT branch) |

SMT ingest routes: `app/api/admin/smt/normalize`, `app/api/admin/smt/raw-upload`, `app/api/internal/smt/ingest-normalize`, `app/api/admin/cron/normalize-smt-catch`.

## Closure checks

```bash
# No read-time GB slot repair in production loader
rg "repairGreenButtonIntervalSeries" lib/usage/actualDatasetForHouse.ts
# expect: no matches

# Droplet uses shared pipeline
rg "runGreenButtonUsagePipeline" scripts/droplet/green-button-upload-server.ts
# expect: match

# Droplet must not define local normalizeGreenButtonReadingsTo15Min
rg "function normalizeGreenButtonReadingsTo15Min" scripts/droplet/green-button-upload-server.ts
# expect: no matches
```

## Deploy note

If production runs `green-button-upload-server.js`, rebuild or sync from `.ts` after changes.
