# SMT unification — chat bootstrap

**PC-2026-05 is complete.** Use this file for **maintenance** (bugfixes, new SMT features) — not for re-running implementation phases unless explicitly restoring history.

**Before any SMT-related code change:** read `docs/SMT_UNIFICATION_COMPLETE.md`, `docs/PROJECT_PLAN.md` → PC-2026-05, and `.cursor/rules/smt-unification-lock.mdc` (permanent, always apply). Keep docs in sync in the same pass.

For historical phase-by-phase work, see `docs/SMT_UNIFICATION_PHASE_PROMPTS.md`.

---

## Paste into new Cursor chat (maintenance / fixes)

Copy everything below into a fresh agent session when changing SMT coverage, heal, readiness, or INTERVAL Past Sim trusted pools.

```
You are changing IntelliWatt SMT interval coverage behavior under the **shipped** PC-2026-05 model. Work surgically; do not weaken single-owner rules without explicit user approval.

## REQUIRED FIRST STEP — read shipped rules

Before any grep, code, or opinion:

1. Read **docs/SMT_UNIFICATION_COMPLETE.md** (shipped owners + forbidden patterns).
2. Read **docs/PROJECT_PLAN.md** → **PC-2026-05** (master plan; overrides informal chat summaries).
3. Read **.cursor/rules/smt-unification-lock.mdc** and **.cursor/rules/shared-sim-window-lock.mdc** — these are permanent constraints.
4. In your first reply, state: (a) you read COMPLETE + PC-2026-05, (b) the specific change requested, (c) which single owner module(s) you will touch.

Do NOT start implementation until you have read the above.

## Then read (in order)

5. docs/SMT_UNIFICATION_PLAN.md — architecture detail (must align with PROJECT_PLAN)
6. docs/USAGE_LAYER_MAP.md — SMT layer owners
7. docs/ONE_PATH_SIM_ARCHITECTURE.md — One Path triggers ensureSmtCoverage only

Optional: `npx tsx scripts/audit-smt-day-coverage.ts <esiid> <dateKey>` when changing slot counting or day status.

## Same-pass doc rule (from PROJECT_PLAN)

Any code change must stay consistent with **docs/PROJECT_PLAN.md PC-2026-05** and **docs/SMT_UNIFICATION_COMPLETE.md**. If you add a new lib owner or change behavior, update COMPLETE, PROJECT_PLAN, and the lock rule in the same pass.

## Shipped model (summary)

- ONE lag knob: lib/usage/canonicalCoverageConfig.ts
- ONE Chicago time path for SMT: lib/time/chicago.ts
- ONE day status read: lib/usage/smtWindowStatus.ts (96/96 strict)
- ONE heal: lib/usage/ensureSmtCoverage.ts (per-session throttle)
- ONE 365-day window: lib/usage/canonicalMetadataWindow.ts

Usage + INTERVAL baseline: show partial SMT intervals. Past Sim INTERVAL: fewer than 96 slots → not in trusted pool.

## Hard rules (see smt-unification-lock.mdc)

- Do NOT edit modules/realUsageAdapter/greenButton.ts for SMT coverage fixes unless scope is explicitly expanded
- modules/onePathSim/** must NOT import modules/usageSimulator/**
- SMT = 96/96 Chicago slots (not 90, not 99% span)
- No duplicate heal/backfill/wait in one-path-sim/route.ts

## Your task this session

Wait for my specific change request. Then:
1. Re-read PC-2026-05 + COMPLETE for anything your change touches
2. IMPLEMENT — minimal diff in the correct single owner module(s)
3. Run closure greps from COMPLETE if you touched completeness, heal, or window metadata
4. Summarize: files changed, tests run, doc updates, alignment with lock rules
```

---

## For you (workflow)

1. New Cursor chat → paste the block above.
2. Describe the specific fix or feature (not a phase number unless auditing history).
3. First reply should confirm it read **COMPLETE** + **PROJECT_PLAN.md → PC-2026-05** + lock rules.

---

## Historical: phase verification (archived)

For auditing original Phases 1–8, use `docs/SMT_UNIFICATION_PHASE_PROMPTS.md` POST-CHECK sections and closure greps in `docs/SMT_UNIFICATION_COMPLETE.md`.

---

## Reference house (optional smoke)

- ESIID: `10400511114390001` · keeper source house `8a6fe8b9-601e-4f9d-aa3e-7ef0b4bddde8`
- Canonical end (lag 2): `2026-05-18`
- After full-window re-ingest / heal-in-span: tail days may show ledger `COMPLETE` in baseline payloads; Usage UI may still lag if daily rows lack `source` (see `docs/MODE_TESTING_HANDOFF_BOOTSTRAP.md`)
- Past Sim canonical end while window unchanged: `PENDING_SMT` → display `SIMULATED_INTERVALS_NOT_AVAILABLE_YET` (not incomplete meter)

