# Mode testing handoff — paste into new Cursor chat

**Created:** 2026-05-20 · **Branch:** `main` · **Active work:** verify all One Path + Usage modes behave correctly end-to-end.

---

## Paste block (copy everything below this line into a new agent chat)

```
You are taking over IntelliWatt mode-testing and Usage ↔ One Path parity work.

## REQUIRED FIRST STEP — read before coding

Read these in order and confirm in your first reply that you read them:

1. docs/MODE_TESTING_HANDOFF_BOOTSTRAP.md (this file — current state + open bugs)
2. docs/CHAT_BOOTSTRAP.txt (house rules + architecture; do not recreate, follow)
3. docs/ONE_PATH_SIM_ARCHITECTURE.md
4. docs/USAGE_LAYER_MAP.md
5. docs/SMT_UNIFICATION_COMPLETE.md + docs/PROJECT_PLAN.md → PC-2026-05
6. .cursor/rules/smt-unification-lock.mdc
7. .cursor/rules/shared-sim-window-lock.mdc

Then skim modules/usageSimulator/kinds.ts for IntervalSeriesKind and the One Path admin route:
app/api/admin/tools/one-path-sim/route.ts

Do NOT start implementation until you have read the above and stated what is broken vs what is already correct.

## What we are doing now

We are **testing every mode** to ensure display labels, data ownership, SMT lifecycle, and analytics passthrough match the shipped contracts:

| Surface | Mode | Run type | Expected behavior |
|---------|------|----------|-------------------|
| User Usage page | SMT / INTERVAL truth | read-only | Show persisted intervals; **no simulation**; daily rows must have `source`/`sourceDetail` (not "SOURCE UNKNOWN") |
| One Path Admin | INTERVAL | BASELINE_PASSTHROUGH | Passthrough only — same upstream truth as Usage; **no sim**; 15-min curve + analytics must match Usage |
| One Path Admin | INTERVAL | PAST_SIM | Sim where rules say so; canonical end day `PENDING_SMT` until window advances; incomplete meter only for true gaps |
| One Path Admin | GREEN_BUTTON | PAST_SIM | Shifted actual days stay ACTUAL; pending tail label on canonical end |
| One Path Admin | MANUAL_MONTHLY / MANUAL_ANNUAL | baseline + Past | Stage 1 read + Stage 2 shared Past; no private sim on baseline |

**Canonical end date (Chicago, lag 2):** `2026-05-18` (verify with `resolveCanonicalUsage365CoverageWindow()`).

**Reference keeper house (Brian interval baseline):**
- Source house: `8a6fe8b9-601e-4f9d-aa3e-7ef0b4bddde8`
- ESIID: `10400511114390001`
- Scenario: `keeper-brian-interval-baseline-primary`
- One Path may pin a lab test home (`29a3d820-...`) — **always confirm which houseId the UI is showing vs which house the payload used**

## Shipped SMT model (do not regress)

- **96/96** Chicago slots = complete day (ledger, heal, Past Sim trusted pool)
- **One heal owner:** `lib/usage/ensureSmtCoverage.ts`
- **Heal scope:** only incomplete days **between first and last persisted SMT interval** (`resolveSmtPersistedCoverageSpan`, `resolveSmtHealBackfillDateKeys` in `lib/usage/smtTailCoverage.ts`) — do not chase pre-history canonical days SMT never sent
- **Full-window admin re-ingest:** `lib/usage/fullWindowSmtReingest.ts` + One Path button `full_window_smt_reingest`
- **Green Button:** do not edit `modules/realUsageAdapter/greenButton.ts` for SMT fixes

## Latest run-log audit (INTERVAL baseline, canonical_run_response)

Payload audited from user paste (One Path copy v2, `BASELINE_PASSTHROUGH`):

**Good / contract-aligned:**
- `runDisplayContract`: 365 rows; tail `2026-05-14`–`2026-05-18` all `ACTUAL` / `ACTUAL`
- Ledger tail: all `COMPLETE` including `2026-05-18`
- `smtPendingIntervalDateKeys`: `[]`
- `rawReadModel.dataset`: 365 daily rows with sources; `insights.fifteenMinuteAverages`: 96 points
- `baselineParityReport.overallMatch`: true (includes `fifteenMinuteCurve`)
- `userUsagePageBaselineContract.dataset`: has daily + fifteenMinute data

**Broken / mismatch (user-reported + payload confirms):**

1. **User Usage tail kWh (FIXED 2026-05-20):** production `/api/user/usage` used naive `T23:59:59.999Z` for insight SQL end bound → canonical end day showed **~37.78 kWh (76 slots)** instead of **~51.47 kWh (96 slots)**. Fix: `getActualUsageDatasetForHouse` full path + `getActualIntervalsForRange*` now use `canonicalCoverageWindowUtcBounds()` from `lib/usage/canonicalMetadataWindow.ts` (same as lightweight admin/baseline path).
   - Re-test: Usage dashboard 5/18 should match One Path baseline passthrough after refresh.

2. **One Path baseline UI:** **15-minute load curve empty** ("Not enough interval data yet") while Usage shows the curve.
   - Payload top-level `userUsageDashboardViewModel.derived.fifteenCurve` was **empty** even though `rawReadModel.dataset.insights.fifteenMinuteAverages` had 96 points.
   - Baseline passthrough uses `buildUserUsageDashboardViewModel` → `viewModel.derived.fifteenCurve` (`modules/onePathSim/runReadOnlyView.ts`, `baselineReadOnlyView.ts`). Likely building view model from a house contract **without** full `dataset.insights` attached.

3. **House ID confusion:** payload `currentControls.actualContextHouseId` (`29a3d820-...`) ≠ `knownScenario.sourceHouseId` (`8a6fe8b9-...`). Parity may compare different houses if not pinned correctly.

4. **Mid-window incomplete:** `smtIncompleteMeterDateKeys` includes `2026-03-08` (and others); heal retry requested `2026-03-08` via `ensure_smt_coverage` (backfill skipped: already requested recent).

## Mode audit checklist (run each, paste copy payload)

For each mode, user pastes **One Path AI copy payload** (`canonical_run_response` or `canonical_last_run_snapshot`). Agent extracts and reports:

- `selectedMode`, `runType`, `engineVersion`, `smtCanonicalEndDate`
- Tail dates `2026-05-14`, `2026-05-17`, `2026-05-18`: ledger status → `runDisplayContract` source/detail
- `smtPendingIntervalDateKeys`, `smtIncompleteMeterDateKeys`
- For baseline: `baselineParityReport`, fifteenMinute count, `userUsagePageBaselineContract` vs `userUsageDashboardViewModel` parity
- For Past Sim: pending tail = `SIMULATED_INTERVALS_NOT_AVAILABLE_YET`; incomplete meter = `SIMULATED_INCOMPLETE_METER`; shifted GB day = `ACTUAL`

**GREEN_BUTTON PAST_SIM (v10) — last known good:** `2026-05-14` ACTUAL (shifted), `2026-05-17` INCOMPLETE_METER → simulated, `2026-05-18` PENDING_SMT → `SIMULATED_INTERVALS_NOT_AVAILABLE_YET`.

## Key code owners (touches for open bugs)

| Bug area | Likely owners |
|----------|----------------|
| Usage missing `source` on daily rows | `lib/usage/actualDatasetForHouse.ts`, `app/api/user/usage/route.ts` |
| Usage 5/18 simulated wrongly | Same + pending-day labeling; compare to `smtDayLedger` / `resolveSmtWindowStatus` |
| One Path baseline empty 15-min curve | `modules/onePathSim/runReadOnlyView.ts`, `simulationVariablePresentation.ts`, ensure `buildUserUsageDashboardViewModel` gets full dataset with `insights.fifteenMinuteAverages` |
| Baseline passthrough labels | User expects passthrough **behavior** (read DB, no sim); `ACTUAL` display on rows may be correct — clarify vs literal "PASSTHROUGH" label |

## Scripts (repo)

- `scripts/tmp-audit-transcript-lines.mjs` — audit pasted payload lines from transcript
- `scripts/tmp-audit-baseline-full.mjs` — deep baseline payload audit
- `npx tsx scripts/audit-smt-day-coverage.ts <esiid> <dateKey>` — DB slot count for a day

## Rules

- Minimal diffs; one owner per concern
- Do not change shared-window ownership without explicit user OK (`.cursor/rules/shared-sim-window-lock.mdc`)
- Do not commit unless user asks
- After contract changes: update COMPLETE + PROJECT_PLAN PC-2026-05 + this file in same pass

## Your first reply should include

1. Confirmation you read the required docs
2. Table: mode × runType × pass/fail from latest payloads
3. Root-cause hypothesis for Usage UNKNOWN source + 5/18 sim vs baseline ACTUAL
4. Proposed fix plan (ordered, smallest first) — then wait for user "go" or implement if they said fix it
```

---

## For the human

1. Open a **new Cursor chat**.
2. Paste the block above.
3. Optionally attach the latest **One Path AI copy JSON** for the mode under test.
4. Say which mode you are testing next (`INTERVAL baseline`, `INTERVAL Past`, `GREEN_BUTTON Past`, `MANUAL_*`, etc.).

## Doc maintenance

When mode-testing fixes land, update in the same PR:

- This file (checklist + known-good dates)
- `docs/CHAT_BOOTSTRAP.txt` (pointer only — keep lean)
- `docs/SMT_UNIFICATION_COMPLETE.md` / `docs/PROJECT_PLAN.md` if SMT/heal/display semantics change
