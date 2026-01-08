## plan-engine-next (WIP)

This folder is a **standalone copy** of the current **manual EFL / fact-card pipeline** codepaths.

### Goals
- Provide a clean place to iterate on a **single, canonical plan engine orchestrator** without touching the live dashboard flows.
- Eventually become the **only** module used by:
  - customer plan search
  - admin fact-card ops tooling
  - background schedulers (daily/weekly/monthly)

### Non-goals (for now)
- No imports from this folder should be wired into production routes yet.
- No behavioral changes are intended while this module is WIP.

### Source of truth (copied from)
- `lib/efl/runEflPipeline.ts`
- `lib/efl/persistAndLinkFromPipeline.ts`


