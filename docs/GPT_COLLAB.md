# GPT Collaboration Rules (Cursor-Only)

## How to Deliver Changes
- Provide **one** Cursor GPT block per task.
- Each block must specify:
  - **Model:** GPT-4o
  - **Thinking:** With Thinking
  - **Agent:** OFF
  - **Files to target:** explicit file list
- Perform only the requested edits; preserve working code outside scope.

## Formatting
- Use explicit before/after edits or inline replacements.
- Do not rely on hidden context; restate constraints within the block.
- Avoid `&&` in shell commands; use one command per line.

## Deploys
- Production deploys happen via Git. Pushing to `main` triggers the Vercel Production build.
- Scheduled jobs are defined in `vercel.json` and applied on the next deploy.

## Guardrails
- Maintain RAW→CDM discipline and token-gated admin routes.
- Avoid refactors unless explicitly requested.
- Keep changes surgical and idempotent.

## Assumptions
- All code is written/accepted through Cursor GPT blocks.
- When asked for “the next step,” provide a single self-contained GPT block.
- If the request is heavy/ambiguous, deliver the best complete block without prompting for confirmation.
