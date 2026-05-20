# SMT unification — completion record

**Status:** Not started — fill this in when Phase 8 post-checks are green.

## Completion checklist

- [ ] Phase 1 — `lib/usage/canonicalCoverageConfig.ts` is the only lag knob
- [ ] Phase 2 — SMT timestamps only in `lib/time/chicago.ts`
- [ ] Phase 3 — `lib/usage/smtWindowStatus.ts` (96/96)
- [ ] Phase 4 — `lib/usage/ensureSmtCoverage.ts` + session throttle
- [ ] Phase 5 — All consumers wired; no parallel One Path SMT heal
- [ ] Phase 6 — Past Sim engines use 96 for INTERVAL/SMT
- [ ] Phase 7 — `lib/usage/canonicalMetadataWindow.ts` single window impl
- [ ] Phase 8 — Closure greps + full test run

## Final single owners

| Concern | Module |
|---------|--------|
| Lag | `lib/usage/canonicalCoverageConfig.ts` |
| Window | `lib/usage/canonicalMetadataWindow.ts` |
| Chicago date/slot | `lib/time/chicago.ts` |
| Day status | `lib/usage/smtWindowStatus.ts` |
| Heal | `lib/usage/ensureSmtCoverage.ts` |

## Completed date

_(YYYY-MM-DD)_

## Notes

_(optional: audit script results for reference house, any SMT delivery lag observations)_
