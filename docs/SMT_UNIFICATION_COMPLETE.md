# SMT unification — completion record

**Status:** Complete (Phases 1–8, PC-2026-05)

**Master plan:** `docs/PROJECT_PLAN.md` → PC-2026-05

**Completed:** 2026-05-20

## Final single owners

| Concern | Module |
|---------|--------|
| Lag (calendar days) | `lib/usage/canonicalCoverageConfig.ts` |
| Chicago date / slot | `lib/time/chicago.ts` |
| Per-day 96/96 status | `lib/usage/smtWindowStatus.ts` |
| Heal (pull, backfill, wait, targeted days) | `lib/usage/ensureSmtCoverage.ts` |
| 365-day window metadata | `lib/usage/canonicalMetadataWindow.ts` |

Simulator modules re-export window helpers from `canonicalMetadataWindow.ts` for backward compatibility. Green Button remains separate (`modules/realUsageAdapter/greenButton.ts`, 90-slot trusted rule unchanged).

## Phase checklist

- [x] Phase 1 — lag knob in `canonicalCoverageConfig.ts`
- [x] Phase 2 — SMT slot/date helpers in `lib/time/chicago.ts`
- [x] Phase 3 — `smtWindowStatus.ts` strict 96/96
- [x] Phase 4 — `ensureSmtCoverage.ts` + session throttle
- [x] Phase 5 — usage, orchestrate, upstream truths wired to ensure
- [x] Phase 6 — Past Sim engines `MIN_TRUSTED_ACTUAL_INTERVALS_PER_DAY = 96` + `chicagoSlot96FromTs`
- [x] Phase 7 — single `resolveCanonicalUsage365CoverageWindow` in lib
- [x] Phase 8 — closure greps + audit script

## Closure greps (2026-05-20)

| Check | Result |
|-------|--------|
| `SMT_READY_COMPLETENESS` in `*.ts` | None |
| `MIN_TRUSTED_ACTUAL_INTERVALS_PER_DAY = 90` in `*.ts` | None |
| `requestTargetedSmtIntervalBackfillForHouse` | Only `ensureSmtCoverage`, `smtIncompleteMeterBackfill`, tests |
| `export function resolveCanonicalUsage365CoverageWindow` | Only `lib/usage/canonicalMetadataWindow.ts` |

## Reference audit (ESIID `10400511114390001`)

Command: `npx tsx scripts/audit-smt-day-coverage.ts <esiid> <dateKey>`

| Chicago date | Slots | `loadSmtDateCoverage` | Ledger | Notes |
|--------------|-------|------------------------|--------|--------|
| 2026-05-16 | 96/96 | complete | COMPLETE | Unchanged since pre-unification |
| 2026-05-17 | 95/96 | incomplete (slot 95 missing) | INCOMPLETE_METER | Same 95/96 finding as Phase 2 |
| 2026-05-18 | 0/96 | incomplete | PENDING_SMT | Expected at canonical window end (lag 2) |

Raw row counts, distinct Chicago slot counts, coverage loader, and ledger reconcile agree on all three days.

## Related docs

- Implementation detail: `docs/SMT_UNIFICATION_PLAN.md`
- Phase prompts: `docs/SMT_UNIFICATION_PHASE_PROMPTS.md`
- New chat bootstrap: `docs/SMT_UNIFICATION_AGENT_BOOTSTRAP.md`
- Cursor rule: `.cursor/rules/smt-unification-lock.mdc` (may be relaxed after sign-off)
