# Usage interval source of truth (SMT + Green Button)

**Status:** Shipped (2026-05-20). **Master plan:** `docs/PROJECT_PLAN.md` → PC-2026-08. **Permanent enforcement:** `.cursor/rules/usage-interval-ingest-lock.mdc`.

## Product rule (non-negotiable)

1. **Ingest once** — parse, timezone/DST, 15-minute bucketing, overlap allocation, and vendor repair run **only** at ingest, before any row is written to the usage interval tables.
2. **Persist once** — `GreenButtonInterval` and `SmtInterval` (and usage-DB mirrors) are the **only** interval truth stores for product surfaces.
3. **Read project only** — Usage, Past Sim, Gap-Fill, plans, and admin tools **load persisted rows** and project through `homeIntervalCalendar` helpers. **No** read-time normalize, **no** read-time slot repair, **no** serving raw vendor rows as if they were canonical intervals.
4. **Fail closed on stale GB** — if Green Button was ingested before `intervalIngestVersion: 1`, consumers return empty / not-ready until re-upload or `rehydrateGreenButtonIntervalsFromRawForHouse`.

Raw files (`rawGreenButton.content`, SMT raw rows, XML/CSV uploads) exist **only** to re-run ingest — never as a live read path for charts, sim, or plan math.

---

## Green Button — single owners

| Concern | Module | Notes |
|---------|--------|--------|
| **Ingest pipeline** | `lib/usage/greenButtonUsagePipeline.ts` | `runGreenButtonUsagePipeline` only |
| Normalize + overlap + repair | `normalizeGreenButtonReadingsTo15Min` | Calls `greenButtonHomeLocalBuckets` + `greenButtonSlotRepair` |
| Overlap (straddle-safe) | `lib/usage/greenButtonHomeLocalBuckets.ts` | DST-safe slot bounds via home TZ |
| Vendor gap repair (/2, /3) | `lib/usage/greenButtonSlotRepair.ts` | **Ingest only**; `repairGreenButtonIntervalSeries` reserved for rehydrate/tests |
| 365-day trim | `lib/usage/greenButtonCoverage.ts` | After normalize |
| Ingest version | `lib/usage/greenButtonIngestContract.ts` | `GREEN_BUTTON_INTERVAL_INGEST_VERSION`; stamped in upload `parseMessage` JSON |
| **Persist** | `GreenButtonInterval` | Canonical 15-min rows (Chicago slot starts as UTC wall clock) |
| **Read** | `lib/usage/loadPersistedGreenButtonIntervals.ts` | → `convertGreenButtonPersistedRowsToHome` |
| **Stale gate** | `lib/usage/greenButtonIntervalReadiness.ts` | `resolveGreenButtonIntervalIngestReadiness` |
| **Rehydrate** | `lib/usage/rehydrateGreenButtonIntervalsFromRaw.ts` | Re-run pipeline from stored raw bytes |

### Ingest entry points (only these may write `GreenButtonInterval`)

| Entry | Must use |
|-------|----------|
| `app/api/green-button/upload/route.ts` | `runGreenButtonUsagePipeline` |
| `scripts/droplet/green-button-upload-server.ts` | `runGreenButtonUsagePipeline` (no forked normalize) |

### Downstream readers (must use persisted + gate)

| Consumer | Path |
|----------|------|
| Usage dashboard | `getActualUsageDatasetForHouse` → `loadPersistedGreenButtonIntervalsForWindow` |
| Range / Past producer | `getActualIntervalsForRangeWithSource` → same loader + readiness |
| Plan monthly buckets | `ensureCoreMonthlyBuckets` (GB branch gated) |
| Plan pipeline | `runPlanPipelineForHome` (GB only if ingest current) |
| One Path GB guard | `assertOnePathGreenButtonPersistedUsage` |
| Past year-shift load | `loadGreenButtonPastYearShiftedPayload` + `fetchGreenButtonIntervalsForCoverageWindow` (gated) |

### Separate from base intervals (not second normalize)

| Module | Role |
|--------|------|
| `modules/realUsageAdapter/greenButton.ts` | Year-shift / trusted-pool **on top of** ingest-trusted DB rows (90-slot GB trust). Shift only — do not re-normalize or re-repair base intervals here. |
| Cached Past artifacts | Snapshots; invalidate when interval fingerprint or ingest version changes |
| `modules/onePathSim/greenButtonIntervalCorrections.ts` | Legacy; do not add new call sites — prefer ingest-trusted rows |

---

## SMT — single owners (already ingest-first)

| Concern | Module |
|---------|--------|
| Normalize to 15-min | `lib/analysis/normalizeSmt.ts`, `app/lib/smt/normalize.ts` |
| Persist | `lib/usage/normalizeSmtIntervals.ts` |
| Heal / coverage (not re-normalize on read) | `lib/usage/ensureSmtCoverage.ts`, `lib/usage/smtWindowStatus.ts` |
| **Read** | `convertSmtPersistedRowsToHome` via `getActualIntervalsForRangeWithSource` |

SMT ingest routes: `app/api/admin/smt/normalize`, `app/api/admin/smt/raw-upload`, `app/api/internal/smt/ingest-normalize`, `app/api/admin/cron/normalize-smt-catch`, `app/api/admin/smt/pull` (inline persist).

**Do not** add read-time `normalizeSmtTo15Min` on production interval fetch paths.

---

## Forbidden patterns (agents and humans)

- Duplicate `normalizeGreenButtonReadingsTo15Min` in Droplet, routes, or adapters.
- `repairGreenButtonIntervalSeries` (or equivalent slot repair) in `actualDatasetForHouse`, Past sim fetch, or plan aggregation.
- SQL or Prisma reads of `GreenButtonInterval` that bypass `loadPersistedGreenButtonIntervals` / readiness gate for **product** surfaces.
- Using `insights.fifteenMinuteAverages` or cached artifact intervals when persisted DB + ingest version disagree with current fingerprint.
- Treating `rawGreenButton` or vendor XML as the live interval series for sim/plans.

---

## Stale Green Button remediation

| Action | When |
|--------|------|
| Re-upload on Droplet / app | Preferred; runs pipeline + stamps `intervalIngestVersion` |
| `rehydrateGreenButtonIntervalsFromRawForHouse({ houseId })` | House has raw bytes but old intervals |
| Past / Usage recalc | After remediation; artifacts may still need rebuild |

Detect: `isGreenButtonIntervalIngestCurrent(upload.parseMessage)`.

---

## Verification (closure greps)

```bash
# No read-time GB slot repair in production loader
rg "repairGreenButtonIntervalSeries" lib/usage/actualDatasetForHouse.ts
# expect: no matches

# Single Droplet ingest
rg "runGreenButtonUsagePipeline" scripts/droplet/green-button-upload-server.ts

# No Droplet-local normalize fork
rg "function normalizeGreenButtonReadingsTo15Min" scripts/droplet/green-button-upload-server.ts
# expect: no matches
```

---

## Doc sync (same pass as code changes)

Update when ingest owners, version, or gate semantics change:

- `docs/PROJECT_PLAN.md` → PC-2026-08
- `docs/PROJECT_CONTEXT.md` (usage SoT section)
- `docs/USAGE_LAYER_MAP.md`
- `docs/USAGE_SIMULATION_PLAN.md`
- `docs/SURFACE_PARITY_OWNERS.md`
- `docs/SMT_UNIFICATION_COMPLETE.md`
- `docs/PAST_SHARED_CORE_UNIFICATION_PLAN.md`
- `docs/UNIFIED_SIM_FINGERPRINT_PLAN.md`
- `docs/SIMULATED_USAGE_TWO_CALLS.md`
- `docs/CHAT_BOOTSTRAP.txt`
- `docs/ONE_PATH_SIM_ARCHITECTURE.md`
- `docs/ARCHITECTURE_STANDARDS.md` · `docs/ADMIN_TOOLS_EXTENSION_PLAN.md` · `docs/SHARED_SIMULATED_DAY_RESULT_REFACTOR_PLAN.md` (Past baseline wording)
- `docs/MODE_TESTING_HANDOFF_BOOTSTRAP.md` · `docs/SMT_UNIFICATION_AGENT_BOOTSTRAP.md`
- `.cursor/rules/usage-interval-ingest-lock.mdc` · `.cursor/rules/smt-unification-lock.mdc` (cross-link)
