# EFL Quarantine Resolution SOP

## 1. Purpose

This SOP defines **how IntelliWatt resolves quarantined EFLs** (items in the EFL review queue) so that:

- We **never** introduce supplier/plan/label‑specific patches into the parser or solver.
- Every resolved item results in a **generalized extraction/normalization/solver rule** that improves the system for future EFLs.
- The goal of resolving a queued EFL is to make the **shared processing path** smarter so the same pattern calculates correctly in the **user page, batch run, auto solver, and manual loader**.
- Persisting or reusing a template may clear stale queue rows, but it is **not** by itself considered the fix when the root cause is a parser/solver miss.
- Solver behavior that computes and persists **per‑card derived numbers** remains allowed and expected.
- Only EFLs with **finalValidationStatus === PASS** are eligible for user‑facing presentation.

## 2. Definitions

- **PASS / FAIL / SKIP**
  - **PASS**: Avg‑price validator confirms modeled prices match EFL’s avg table within tolerance; card is considered numerically consistent.
  - **FAIL**: Validator finds one or more points outside tolerance or detects structurally inconsistent math; card must be quarantined for admin review.
  - **SKIP**: Validator cannot run meaningfully (e.g., missing numeric TDSP data or assumption‑based example table only); card is not trusted and must remain in admin review unless explicitly handled by policy.

- **Solver vs. Parser responsibilities**
  - **Parser** (extractor + normalizer + AI):
    - Reads `rawText` from pdftotext and extracts structured fields into `planRules` and `rateStructure`.
    - Handles base charge, energy tiers, bill credits, plan metadata, TOU windows, TDSP‑included flags, etc.
  - **Solver** (`solveEflValidationGaps` + related helpers):
    - Works *on top of* parser output to fill gaps **using constraints**, e.g., avg‑price table vs. modeled math, TDSP tariff tables.
    - May compute derived values (e.g., base charge, missing tiers) and feed them into **derivedPlanRules/derivedRateStructure** for validation or persistence.

- **Quarantine / Review Queue responsibilities**
  - The **review queue** holds any EFL where:
    - Final validation status is **FAIL** or **SKIP**, or
    - `queueReason` indicates a concern (e.g., masked TDSP unsolved, tier coverage incomplete).
  - Responsibilities:
    - Prevent these EFLs from being user‑facing.
    - Provide a focused list for admins to triage and identify **generalizable fixes**.
    - Record failure taxonomy + “next‑time prevention” strategy (which rule/heuristic will be added or why it is unsolvable).

## 3. Non-Negotiable Rules

- **No supplier‑specific if/else patches.**
- **No label/plan‑name keyed rules.**
- Any new logic must be expressed as: **input pattern → extraction/normalization → normalized field mapping**.
- Solver **may** store derived numbers per template/card (e.g., fixed base charge, tier rates) when those numbers are deterministically inferred; this is allowed.
- If the solver and parser **cannot** solve an EFL to PASS within tolerance:
  - The EFL **must not** be presented to users.
  - It **must** remain in admin review (quarantined) unless explicitly labeled as “unsolvable / needs human data” and protected by policy.

### 3.1 Auto-resolution (queue self-healing)

- The review queue should only contain items that **still need attention**.
- If a matching EFL template (`RatePlan.rateStructure`) exists and does **not** require manual review, the corresponding **OPEN** quarantine row should be auto-resolved.
  - This is handled automatically by admin tooling (queue refresh / batch parsing) so admins do not have to clear items one-by-one.
  - DRY_RUN operations must remain side-effect-free and must not auto-resolve.
- Auto-resolution is a **queue hygiene** step, not the definition of success:
  - If the underlying EFL still fails to parse/validate on a fresh shared-path rerun, the work is **not done** even if a stored template exists.
  - The actual success condition is that the shared parser/solver path can process that EFL pattern correctly without relying on a one-off rescue path.

### 3.2 Template persistence guardrail (no incomplete templates)

- A RatePlan should only be considered a **Template** when it has a stored `rateStructure` *and* the core identity/display fields are present:
  - `supplier` (provider/brand)
  - `planName`
  - `termMonths`
  - `eflVersionCode`
- If any of these are missing, the pipeline must **not** persist `rateStructure` (so the row does not appear in Templates) and the item must remain/land in quarantine for review.
- Admin tooling may **invalidate** such templates (clear `rateStructure`, set `eflRequiresManualReview=true`) to allow clean reparse and prevent bad rows from acting as cache hits.

## 4. Triage Workflow

1. **Open admin review item**
   - Go to `/admin/efl-review` or the equivalent EFL review queue page.
   - Filter to *Open* items.
2. **Click EFL URL**
   - Open the EFL PDF (via the stored `eflUrl`) in a new tab for direct inspection.
3. **Identify what’s missing or misparsed**
   - Examples:
     - Base monthly charge not populated or incorrect.
     - Energy tiers incomplete (e.g., only first tier captured).
     - Bill credit thresholds not extracted.
     - TOU time windows missing or misaligned.
     - TDSP‑included flag not set correctly.
     - Avg‑price validator FLAGs a mismatch but math appears correct to a human.
4. **Decide where the fix belongs (layer selection)**
   - **Extractor**:
     - Raw regex/heuristics over `rawText` for base charge, tiers, credits, TOU windows, etc.
   - **AI normalization / prompt rules**:
     - When the model is ignoring or misinterpreting certain repeated patterns that need clearer instructions.
   - **Deterministic fallback**:
     - Regex‑based post‑processing inside the parser to fill fields from `rawText` (e.g., Energy Charge tiers, base charge synonyms, bill credit patterns).
   - **Validator**:
     - Rules that affect how avg‑price validation is interpreted (e.g., SKIP vs FAIL when TDSP data is unknown).
   - **Solver**:
     - Gap‑fill steps that derive missing variables (tiers, base charge, TDSP assumptions) using constraints such as the avg‑price table and tariff data.
5. **Document failure category and intended fix**
   - Assign a taxonomy code (e.g., `BASE_CHARGE_SYNONYM`, `TIER_MISSING_GT_RANGE`, `ASSUMPTION_TABLE_ONLY`).
   - Write down the generalized rule/heuristic you intend to implement.
6. **Verify the fix on the shared path**
   - Confirm the generalized fix works through the shared processing path used by:
     - user pricing/read flows,
     - batch parsing,
     - auto-solver/validation reruns, and
     - manual loader/admin reruns.
   - A queue item is only considered truly resolved when future runs of the same EFL pattern stay out of quarantine for the **right reason**: the parser/solver now understands it.

## 5. Fix Strategy Matrix

| Symptom                                | Likely Cause                                | Fix Layer          | General Rule Example                                                                 | Required Regression Artifact                                              |
| -------------------------------------- | ------------------------------------------- | ------------------ | ------------------------------------------------------------------------------------ | -------------------------------------------------------------------------- |
| Base charge missing                    | New “Base Monthly Charge” wording           | Extractor / Fallback | Add regex matching `Base (Monthly )?Charge` with `$X per billing cycle/month`.      | Fixture with that wording + test asserting `baseChargePerMonthCents` set. |
| Only first tier captured               | `"> 1200 kWh"` tier not matched             | Extractor / Solver | Loosen regex to match `> N kWh` anywhere in line and treat as tier starting at N+1. | Fixture with multi‑tier EFL + test expecting 2+ tiers in `usageTiers`.     |
| Bill credit not recognized             | New threshold phrase                        | Extractor / Fallback | Match “bill credit of $X … usage is Y kWh or more” variants with flexible wording.  | Fixture + test checking `billCredits[]` contains correct threshold/amount. |
| Avg-price FAIL but math looks correct  | Missing base charge or tier in model        | Solver             | Add base‑charge or tier sync step (from raw text or rate structure) before validate | Test showing FAIL→PASS with `validation.status === "PASS"`.               |
| SKIP due to assumption‑based table    | Table is clearly example-only              | Validator          | Detect assumption‑based phrases and mark as `ASSUMPTION_TABLE_ONLY` SKIP reason.    | Fixture + test checking SKIP with specific `queueReason` text.            |
| TDSP masked with “**” and unsolved    | No tariff lookup / ambiguous territory/date | Solver / Validator | Improve TDSP inference or document as `UNRESOLVABLE_TDSP_MASKED` with clear reason. | Fixture + test verifying SKIP/FAIL and stable `queueReason`.              |

## 6. Regression Requirements

- **Fixture**:
  - Add a representative `rawText` snippet or full text fixture in the established fixtures directory (e.g., `fixtures/efl/...`), named to reflect the issue.
- **Parser extraction test**:
  - Add an automated test (unit or integration) that:
    - Asserts the previously missing field (e.g., base charge, tier, credit) is now present and numerically correct.
- **Validator/solver behavior test**:
  - Add a test that:
    - Asserts the avg‑price validator’s status changes as intended (e.g., FAIL → PASS), or
    - Confirms FAIL/SKIP remains but with a **correct and stable `queueReason`** and `assumptionsUsed` flags.

## 7. Guard Rails (Recommended)

- Only show **user‑facing numbers** when `finalValidationStatus === "PASS"`.
- Consider a **parseConfidence** threshold for user‑facing display (e.g., avoid surfacing cards with low confidence even if PASS, pending UX decisions).
- Add **sanity bounds checks** at the design level (to be codified separately):
  - Reject or quarantine rates that are clearly absurd (e.g., 10,000 ¢/kWh) or negative charges where not expected.
  - Guard against unit mixups (e.g., $/MWh vs ¢/kWh) via separate validation passes.

## 8. “Done” Checklist

Use this checklist for every quarantined EFL item before marking it resolved:

- [ ] Issue categorized (failure taxonomy code assigned).
- [ ] General rule implemented (no supplier/plan/label‑specific keys).
- [ ] Regression fixture added (rawText snippet or full text in fixtures).
- [ ] Regression test added and passing (parser + validator/solver as appropriate).
- [ ] Shared-path behavior verified so user page, batch run, auto solver, and manual loader all benefit from the same fix.
- [ ] `docs/PROJECT_PLAN.md` updated with what changed, which **rule ID** was added/updated, and which fixture/test was added.


