# SMT unification — new chat bootstrap

Copy everything in **“Paste into new Cursor chat”** below into a fresh agent session. Run **one phase per chat**, then verify post-checks before the next phase.

---

## Paste into new Cursor chat

```
You are implementing the IntelliWatt SMT interval coverage unification (PC-2026-05). Work surgically — ONE phase only unless I say otherwise.

## REQUIRED FIRST STEP — read the master project plan

Before any grep, code, or opinion:

1. Open and read **docs/PROJECT_PLAN.md** — search for **`PC-2026-05`** and read that entire section end-to-end. This is the **master** plan file; it overrides informal summaries in chat.
2. Confirm you understand: product rules, 8 phases, target lib/ owners, forbidden items, Green Button out of scope, One Path isolation.
3. In your first reply, briefly state: (a) that you read PC-2026-05 in PROJECT_PLAN.md, (b) which phase I assigned, (c) one sentence on what that phase changes.

Do NOT start implementation until you have read PC-2026-05 in PROJECT_PLAN.md.

## Then read (in order)

4. docs/SMT_UNIFICATION_PLAN.md — implementation detail, file map (must align with PROJECT_PLAN; if conflict, PROJECT_PLAN wins)
5. docs/SMT_UNIFICATION_PHASE_PROMPTS.md — PRE-CHECK / IMPLEMENT / POST-CHECK for your phase number
6. .cursor/rules/smt-unification-lock.mdc
7. .cursor/rules/shared-sim-window-lock.mdc
8. docs/USAGE_LAYER_MAP.md — SMT layer owners (especially Phase 5+)
9. docs/ONE_PATH_SIM_ARCHITECTURE.md — One Path must only trigger ensureSmtCoverage, not own SMT

Optional: scripts/audit-smt-day-coverage.ts — only when the phase touches slot counting or day status.

## Same-pass doc rule (from PROJECT_PLAN)

Any code change for this effort must stay consistent with **docs/PROJECT_PLAN.md PC-2026-05**. If you add a new lib owner or change behavior, update PROJECT_PLAN / SMT_UNIFICATION_PLAN in the same pass when the phase requires it.

## What you are building (summary — detail is in PROJECT_PLAN)

- ONE lag knob: lib/usage/canonicalCoverageConfig.ts (2 today; 3 in one place later)
- ONE Chicago time path for SMT: lib/time/chicago.ts
- ONE day status read: lib/usage/smtWindowStatus.ts (96/96 strict)
- ONE heal: lib/usage/ensureSmtCoverage.ts (per-session throttle)

Usage + INTERVAL baseline: show partial SMT intervals.
Past Sim INTERVAL: < 96 slots → not in trusted pool; simulate.

## Hard rules

- Do NOT edit modules/realUsageAdapter/greenButton.ts
- modules/onePathSim/** must NOT import modules/usageSimulator/** — shared code in lib/** only
- SMT = 96/96 Chicago slots (not 90, not 99% span) where this phase touches completeness
- No global “Phase 0” — only this phase’s pre-check and post-check in SMT_UNIFICATION_PHASE_PROMPTS.md
- Do not advance to the next phase until I confirm post-checks are green

## Your task this session

Wait for: **Run Phase N only.**

Then:
1. Re-read PC-2026-05 in PROJECT_PLAN.md for anything specific to Phase N
2. Run Phase N PRE-CHECK from docs/SMT_UNIFICATION_PHASE_PROMPTS.md
3. IMPLEMENT — minimal diff
4. POST-CHECK — fix until green
5. Summarize: files changed, tests run, PROJECT_PLAN alignment, ready for Phase N+1 or blockers

Ask me for the phase number if I have not given it yet.
```

---

## For you (workflow)

1. New Cursor chat → paste the block above.
2. Send: `**Run Phase 1 only.**` (then 2, 3, …).
3. First reply from agent should confirm it read **PROJECT_PLAN.md → PC-2026-05**.
4. Review chat: use verification prompt below.

---

## Verification chat bootstrap (review agent)

```
Verify Phase N SMT unification work.

REQUIRED: Read docs/PROJECT_PLAN.md — section PC-2026-05 — and confirm the code change matches that section for Phase N.

Then run Phase N POST-CHECK from docs/SMT_UNIFICATION_PHASE_PROMPTS.md (greps + tests).

Report:
- Did implementation match PROJECT_PLAN PC-2026-05? (yes/no + gaps)
- Post-check pass/fail per item
- Stragglers to fix before Phase N+1

Do not implement Phase N+1 unless I ask.
```

Replace `N` with 1–8.

---

## Reference house (optional smoke)

- ESIID: `10400511114390001`
- Dates: `2026-05-16` (96/96), `2026-05-17` (often 95/96), `2026-05-18` (canonical end, often pending)

