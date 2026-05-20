# SMT unification — phase prompts (copy-paste)

**Read first:** `docs/SMT_UNIFICATION_PLAN.md` and `docs/SMT_UNIFICATION_AGENT_BOOTSTRAP.md`

**Rules every phase:** No edits to `modules/realUsageAdapter/greenButton.ts`. SMT = 96/96 strict when phase touches completeness. `modules/onePathSim/**` must not import `modules/usageSimulator/**`. No standalone Phase 0 — only this phase’s pre-check → implement → post-check → fix until green.

**Execution order:** 1 → 2 → 3 → 4 → 5 → 6 → 7 → 8 (6 before 8 required; 7 may swap with 6).

---

## Phase 1 — Single lag knob

```
Phase 1 — single canonical coverage lag config. Surgical. No Green Button edits.

GLOBAL: Do not edit modules/realUsageAdapter/greenButton.ts. Do not change SMT 96/96 rules yet.

PRE-CHECK (run first, record results):
- rg "canonicalCoverageLagDays:\s*2|reliableLagDays:\s*2" --glob "*.ts"
- rg "CANONICAL_COVERAGE_LAG_DAYS" --glob "*.ts"  (expect no matches yet)
- Read lib/time/chicago.ts rollingAutoAnchorEndDateChicago — note if it uses ms*24h*lag

IMPLEMENT:
1) Add lib/usage/canonicalCoverageConfig.ts:
   - export CANONICAL_COVERAGE_LAG_DAYS = 2
   - export CANONICAL_COVERAGE_TOTAL_DAYS = 365
   (ONLY place to change lag 2→3 later)

2) Wire modules/usageSimulator/simulationVariablePolicy.ts adapterCanonicalInput to import those constants (no literal 2).

3) Wire modules/onePathSim/simulationVariablePolicy.ts the same way (values from lib only).

4) modules/usageSimulator/metadataWindow.ts and modules/onePathSim/usageSimulator/metadataWindow.ts — pass policy lag from lib-backed policy.

5) lib/admin/gapfillLabPrime.ts — remove hardcoded reliableLagDays: 2; use lib config.

6) lib/time/chicago.ts:
   - canonicalUsageWindowForTimezone default reliableLagDays from lib config when omitted
   - rollingAutoAnchorEndDateChicago: calendar lag via prevCalendarDayDateKey(chicagoDateKey(now), lag), NOT ms subtraction

7) Tests: update/add tests/time/canonicalUsageWindowChicago.test.ts — lag 2 behavior + test that lag 3 shifts endDate back one calendar day when config is 3.

POST-CHECK (fix until all pass):
- rg "canonicalCoverageLagDays:\s*2|reliableLagDays:\s*2" --glob "*.ts" → only lib config + test fixtures (no production literals)
- rg "CANONICAL_COVERAGE_LAG_DAYS" --glob "*.ts" → policy files + chicago + metadataWindow paths import it
- rollingAutoAnchorEndDateChicago has no getTime() - lag * 24*60*60*1000
- npm test -- tests/time/canonicalUsageWindowChicago.test.ts
- npm test -- tests/usageSimulator/onePathInternalIsolation.source.test.ts
- git diff modules/realUsageAdapter/greenButton.ts → empty
```

---

## Phase 2 — SMT timestamps

```
Phase 2 — consolidate SMT date-key and slot-96 conversions in lib/time/chicago.ts. No Green Button edits.

GLOBAL: Do not edit modules/realUsageAdapter/greenButton.ts. No completeness threshold changes.

PRE-CHECK:
- git diff modules/realUsageAdapter/greenButton.ts → must be empty before starting
- rg "function chicagoDateKey|chicagoDateKeyFromBucket|smtCoverageDateFmt|smtCoverageSlotFmt|chicagoSlot96FromTs" --glob "*.ts"
- rg "from \"@/lib/time/chicago\"" lib/usage/smtTailCoverage.ts app/api/user/smt/orchestrate/route.ts lib/usage/actualDatasetForHouse.ts

IMPLEMENT:
1) Move chicagoSlot96FromTs and SMT date-key helper(s) from lib/usage/smtTailCoverage.ts into lib/time/chicago.ts (export). smtTailCoverage imports from chicago — remove duplicate Intl formatters there.

2) Replace local chicagoDateKey duplicates in SMT paths only:
   - lib/usage/actualDatasetForHouse.ts (SMT labeling paths only — do not alter GREEN_BUTTON branches)
   - app/api/user/usage/status/route.ts
   - app/api/user/smt/orchestrate/route.ts
   - modules/realUsageAdapter/smt.ts

3) Keep lib/time/tz.ts for ingest parsing; do not merge tz into chicago this phase.

4) Update tests/usage/smtTailCoverage.test.ts imports.

5) Add tests/time/chicagoSlot96.test.ts — DST boundaries (spring forward / fall back) for slot 0 and 95.

POST-CHECK:
- git diff modules/realUsageAdapter/greenButton.ts → empty
- rg "smtCoverageDateFmt|smtCoverageSlotFmt" --glob "*.ts" → none outside chicago.ts (or deleted)
- rg "function chicagoDateKey" --glob "*.ts" → only lib/time/chicago.ts (+ greenButton.ts local OK, untouched)
- chicagoSlot96FromTs defined once in lib/time/chicago.ts; other files import it
- npm test -- tests/time/chicagoSlot96.test.ts tests/usage/smtTailCoverage.test.ts
- If slot helper moved: npx tsx scripts/audit-smt-day-coverage.ts for 2026-05-17 — slot count must match pre-phase note (still 95/96 if DB unchanged)
```

---

## Phase 3 — Window day status (96/96)

```
Phase 3 — single SMT window day status reader (96/96 strict). No heal wiring yet. No Green Button edits.

GLOBAL: Do not edit greenButton.ts. Do not add ensureSmtCoverage yet.

PRE-CHECK:
- rg "SMT_READY_COMPLETENESS|0\.99" app/api/user/smt/orchestrate/route.ts app/api/user/usage/status/route.ts
- rg "loadSmtDateCoverage|smtDayCoverageLedger" lib/usage --glob "*.ts"
- Confirm lib/time/chicago.ts exports chicagoSlot96FromTs (Phase 2 done)

IMPLEMENT:
1) Create lib/usage/smtWindowStatus.ts:
   - resolveSmtCanonicalWindow(now?) using lib/usage/canonicalCoverageConfig.ts + canonicalUsageWindowChicago
   - loadSmtWindowDayStatus({ esiid, dateKeys? }) — default all keys in canonical window
   - Use loadSmtDateCoverage + ledger; per day: slotCount, missingSlots, ledgerStatus, isComplete: slotCount === 96
   - export SMT_REQUIRED_SLOTS_PER_DAY = 96

2) Refactor lib/usage/smtTailCoverage.ts snapshot builders to use smtWindowStatus (no parallel counting logic).

3) app/api/user/smt/orchestrate/route.ts and app/api/user/usage/status/route.ts — SMT readiness uses smtWindowStatus (strict 96); remove SMT_READY_COMPLETENESS span logic for SMT.

4) tests/usage/smtWindowStatus.test.ts + update smtTailCoverage tests.

POST-CHECK:
- rg "SMT_READY_COMPLETENESS" --glob "*.ts" → no matches in orchestrate/status
- rg "SMT_REQUIRED_SLOTS_PER_DAY|slotCount === 96" lib/usage/smtWindowStatus.ts
- npm test -- tests/usage/smtWindowStatus.test.ts tests/usage/smtTailCoverage.test.ts
- npx tsx scripts/audit-smt-day-coverage.ts for canonical window end day — ledger must match smtWindowStatus
- git diff modules/realUsageAdapter/greenButton.ts → empty
- npm test -- tests/usageSimulator/onePathInternalIsolation.source.test.ts
```

---

## Phase 4 — Heal owner + session throttle

```
Phase 4 — single SMT heal orchestrator in lib/usage with per-session throttle. No Green Button edits.

GLOBAL: requestTargetedSmtIntervalBackfillForHouse must only be invoked from lib/usage after this phase.

PRE-CHECK:
- rg "requestTargetedSmtIntervalBackfillForHouse|maybeRunOnePathSmtPostSimHealing|maybeRefreshOnePathSmtTailCoverage" --glob "*.ts"
- rg "ensureSmtTailCoverageForUserHouse" --glob "*.ts"
- Confirm lib/usage/smtWindowStatus.ts exists (Phase 3)

IMPLEMENT:
1) Create lib/usage/ensureSmtCoverage.ts — see docs/SMT_UNIFICATION_PLAN.md session contract.

2) Keep lib/usage/smtIncompleteMeterBackfill.ts; only callable from ensureSmtCoverage.

3) Remove direct requestTargetedSmtIntervalBackfillForHouse from app/api/admin/tools/one-path-sim/route.ts post-sim healing.

4) tests/usage/ensureSmtCoverage.test.ts

POST-CHECK:
- rg "requestTargetedSmtIntervalBackfillForHouse" --glob "*.ts" → only lib/usage (backfill + ensure + tests)
- rg "maybeRunOnePathSmtPostSimHealing" app/api/admin/tools/one-path-sim/route.ts → removed or ensure-only wrapper
- npm test -- tests/usage/ensureSmtCoverage.test.ts tests/usage/admin.onePathSim.route.test.ts
- git diff modules/realUsageAdapter/greenButton.ts → empty
```

---

## Phase 5 — Wire consumers

```
Phase 5 — wire Usage, orchestrate, upstream truths to smtWindowStatus + ensureSmtCoverage. No Past Sim engine threshold change yet. No Green Button edits.

PRE-CHECK:
- rg "ensureSmtTailCoverageForUserHouse" --glob "*.ts"
- rg "from \"@/modules/onePathSim" app/api/user --glob "*.ts"
- rg "ensureSmtCoverageForHouse" --glob "*.ts"

IMPLEMENT: See docs/SMT_UNIFICATION_PLAN.md Phase 5 file list.

POST-CHECK:
- rg "ensureSmtTailCoverageForUserHouse" --glob "*.ts" → not in app routes
- npm test -- tests/onePathSim/upstreamUsageTruth.tail.test.ts tests/usage/admin.onePathSim.route.test.ts tests/usageSimulator/onePathInternalIsolation.source.test.ts
- git diff modules/realUsageAdapter/greenButton.ts → empty
```

---

## Phase 6 — Past Sim strict 96

```
Phase 6 — Past Sim trusted pool strict 96/96 for SMT INTERVAL paths only. No Green Button edits.

PRE-CHECK:
- rg "MIN_TRUSTED_ACTUAL_INTERVALS_PER_DAY" --glob "*.ts"
- git diff modules/realUsageAdapter/greenButton.ts → empty

IMPLEMENT:
- modules/simulatedUsage/engine.ts and modules/onePathSim/simulatedUsage/engine.ts → 96, chicagoSlot96FromTs
- GREEN_BUTTON branches unchanged

POST-CHECK:
- rg "MIN_TRUSTED_ACTUAL_INTERVALS_PER_DAY = 90" → none
- npm test -- tests/onePathSim tests/simulatedUsage (targeted)
- git diff modules/realUsageAdapter/greenButton.ts → empty
```

---

## Phase 7 — Metadata dedupe

```
Phase 7 — single lib owner for resolveCanonicalUsage365CoverageWindow. No Green Button edits.

PRE-CHECK:
- rg "resolveCanonicalUsage365CoverageWindow" --glob "*.ts"
- rg "export function resolveCanonicalUsage365CoverageWindow" --glob "*.ts"

IMPLEMENT:
- lib/usage/canonicalMetadataWindow.ts
- thin modules/usageSimulator/metadataWindow.ts and modules/onePathSim/usageSimulator/metadataWindow.ts

POST-CHECK:
- single implementation in lib
- lag 3 test via lib config only
- onePathInternalIsolation.source.test.ts passes
```

---

## Phase 8 — Closure

```
Phase 8 — closure only. No Green Button edits.

POST-CHECK greps: see docs/SMT_UNIFICATION_PLAN.md Phase 8 section.

npm test -- tests/usage tests/time tests/onePathSim/upstreamUsageTruth.tail.test.ts tests/usageSimulator/onePathInternalIsolation.source.test.ts

Create docs/SMT_UNIFICATION_COMPLETE.md when green.
```
