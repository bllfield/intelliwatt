# EFL Parser Rules (Generalized Extraction Catalog)

> **Purpose**
>
> This document is a **living catalog** of generalized EFL parsing rules. Each rule is:
> - **Pattern‑based** (regexes or structural signals over `rawText`).
> - **Reusable across suppliers and plans**.
> - Expressed as: **Rule ID → Intent → Input pattern(s) → Output field(s) → False‑positive controls → Known examples**.
>
> **Rules must never be keyed to a specific supplier, plan name, PDF SHA, or label text.**

---

## Rule R‑BASE‑001 — Base Monthly Charge (Canonical)

- **Intent**
  - Capture the EFL’s fixed base monthly charge and map it to:
    - `planRules.baseChargePerMonthCents`
    - `rateStructure.baseMonthlyFeeCents` (when applicable)

- **Input pattern(s)**
  - Lines containing variants of:
    - `Base Charge: $X.XX per billing cycle`
    - `Base Charge $X.XX per billing cycle`
    - `Base Monthly Charge $X.XX per month`
    - `Chariot Energy Base Monthly Charge $9.95 per billing cycle`
  - Generic regex examples (language‑level, not code):
    - `Base (Monthly )?Charge[:\s]*\$([0-9]+\.[0-9]{2})\s+(per billing cycle|per month)`

- **Output field(s)**
  - `baseChargePerMonthCents = round(dollars * 100)`
  - `baseMonthlyFeeCents = baseChargePerMonthCents` when `rateStructure` is present and field is unset.

- **False‑positive controls**
  - Require **currency marker** (`$`) and **per‑billing‑cycle/month** phrase.
  - Exclude lines containing clearly unrelated context (e.g., “Base charge for TDSP riders” if that is modeled separately).

- **Known examples**
  - Chariot Solarize 12 and similar fixed plans with clearly labeled base monthly charges.

---

## Rule R‑TIER‑001 — Two‑Tier Energy Charge (0–N, >N)

- **Intent**
  - Capture multi‑tier energy charges expressed as:
    - `0 - 1200 kWh 12.5000¢`
    - `> 1200 kWh 20.4000¢`

- **Input pattern(s)**
  - Lines under “Energy Charge” or similar sections that include:
    - `0 - N kWh` + `X.XXXX¢`
    - `> N kWh` + `Y.YYYY¢`
  - Conceptual regex:
    - `0\s*[-–]\s*(\d{3,4})\s*kWh.*?([0-9]+\.[0-9]+)\s*¢`
    - `>\s*(\d{3,4})\s*kWh.*?([0-9]+\.[0-9]+)\s*¢`

- **Output field(s)**
  - `planRules.usageTiers[]` appended with:
    - Tier 1: `{ minKwh: 0, maxKwh: N, rateCentsPerKwh: centsFromFirstLine }`
    - Tier 2: `{ minKwh: N+1, maxKwh: null, rateCentsPerKwh: centsFromSecondLine }`
  - Mirror into `rateStructure.usageTiers[]` (if applicable) when missing.

- **False‑positive controls**
  - Only apply within recognized pricing sections (e.g., near “Energy Charge” header).
  - Require `kWh` token + `¢`/`cents per kWh` token on the same line or adjacent line.

- **Known examples**
  - TXU tiered EFLs and similar two‑tier plans where higher usage pays a different rate.

---

## Rule R‑TIER‑002 — Bracketed Energy Charge Tiers (“(0 to N kWh)”)

- **Intent**
  - Capture Rhythm‑style and similar tiers expressed as:
    - `Energy Charge: (0 to 1000 kWh) 10.9852¢ per kWh`
    - `Energy Charge: (> 1000 kWh) 12.9852¢ per kWh`

- **Input pattern(s)**
  - Lines under “Energy Charge” section with bracketed ranges:
    - `(0 to N kWh) X.XXXX¢`
    - `(> N kWh) Y.YYYY¢`
  - Conceptual regex:
    - `\((0|> ?\d+)\s*(to\s*\d+)?\s*kWh\).*?([0-9]+\.[0-9]+)\s*¢`

- **Output field(s)**
  - `planRules.usageTiers[]` entries with:
    - `(0 to N kWh)` → `{ minKwh: 0, maxKwh: N, rateCentsPerKwh: cents }`
    - `(> N kWh)` → `{ minKwh: N+1, maxKwh: null, rateCentsPerKwh: cents }`

- **False‑positive controls**
  - Restrict to lines explicitly labeled as “Energy Charge” or equivalent.
  - Ignore parenthetical ranges that clearly refer to non‑pricing concepts (e.g., account numbers).

- **Known examples**
  - Rhythm “PowerShift” style products and other EFLs that use bracketed ranges.

---

## Rule R‑CREDIT‑001 — Usage‑Threshold Bill Credits

- **Intent**
  - Detect bill credits that apply when monthly usage crosses a specified threshold, e.g.:
    - `Usage Credit for 1,000 kWh or more: $100.00 per month`
    - `$125.00 bill credit when your usage is 1,000 kWh or more`

- **Input pattern(s)**
  - Lines containing **dollar amount + “credit” + kWh threshold**:
    - `\$([0-9]+\.[0-9]{2}).*credit.*(>=|greater than|or more)\s+([0-9,]+)\s*kWh`
    - `Usage Credit.*([0-9,]+)\s*kWh or more.*\$([0-9]+\.[0-9]{2})`

- **Output field(s)**
  - `planRules.billCredits[]` entries with:
    - `amountCents`
    - `minKwhThreshold`
    - `perMonth = true`
  - Mirror into `rateStructure.billCredits[]` where applicable.

- **False‑positive controls**
  - Require explicit **credit** keyword and **kWh threshold** in the same logical block.
  - Exclude references to one‑time signup bonuses or non‑usage‑based incentives.

- **Known examples**
  - Gexa / TXU style “usage credit for X kWh or more” EFLs.

---

## Rule R‑TDSP‑INCLUDED‑001 — Delivery Included in Energy Charge

- **Intent**
  - Detect when the EFL explicitly states that **TDSP/TDU delivery charges are included** in the REP’s energy charge, to prevent double‑counting delivery later.

- **Input pattern(s)**
  - Phrases in `rawText` such as:
    - `Delivery charges are included in the energy charge`
    - `TDU delivery charges included in Energy Charge`
    - `Delivery included in this rate`
  - Conceptual pattern:
    - `delivery (charges )?included (in|with) (the )?(energy rate|Energy Charge|price)`

- **Output field(s)**
  - `planRules.tdspDeliveryIncludedInEnergyCharge = true`
  - `rateStructure.tdspDeliveryIncludedInEnergyCharge = true`

- **False‑positive controls**
  - Ignore statements about delivery being **passed through** or **billed separately**.
  - Require explicit “included” semantics, not just presence of “delivery” and “energy” words.

- **Known examples**
  - Fixed‑rate products marketed as “delivery included” or “all‑in” on the EFL disclosure.

---

## Rule R‑META‑PUCT‑001 — REP PUCT Certificate Extraction

- **Intent**
  - Extract the REP’s PUCT certificate/license/REP number into a normalized identifier.

- **Input pattern(s)**
  - Variants of:
    - `PUCT Certificate No. 10004`
    - `PUCT Cert. #10027`
    - `PUCT License # 10052`
    - `REP No. 10004`
  - Conceptual regex:
    - `(?:PUCT\s*(?:Certificate\s*(?:No\.?|Number)?|Cert\.?|License)|REP\s*No\.)\s*[#:.\s]*([0-9]{4,6})`

- **Output field(s)**
  - `repPuctCertificate` as a normalized string (e.g., `"10004"`).

- **False‑positive controls**
  - Restrict to blocks clearly labeled with PUCT/REP context.
  - Ignore unrelated 4–6 digit numeric tokens (e.g., dates, zip codes) without the PUCT/REP keyword.

- **Known examples**
  - Multiple REPs’ EFLs with different PUCT wordings and formatting variants.

---

## Rule R‑META‑VER‑001 — EFL Version Code Extraction

- **Intent**
  - Extract the EFL version identifier to drive template identity and dedupe.

- **Input pattern(s)**
  - Header/footer variants such as:
    - `EFL Version: ABC123`
    - `EFL Ver. #: 2024-01`
    - `Ver. #: XYZ-10`
    - Footer style: `Version 10.0`
    - `EFL_ABC_2024_01` style tokens in filenames or footers.
  - Conceptual patterns:
    - `EFL Version:\s*(\S.+)` (possibly reading code from next non‑empty line)
    - `EFL_([A-Za-z0-9_]+)`
    - `Version\s+([0-9]+(?:\.[0-9]+)?)`

- **Output field(s)**
  - `eflVersionCode` as a normalized string (e.g., `Version 10.0`, `ABC_2024_01`).

- **False‑positive controls**
  - Prefer patterns near known EFL headers/footers, not arbitrary “Version” terms elsewhere.
  - Avoid capturing software version strings or document template versions unless clearly labeled as EFL version.

- **Known examples**
  - REP EFLs with footer‑only `Version 10.0` markers and `_EFL_` style filenames.

---

> **Note**
>
> When adding new rules:
>
> - Assign a **Rule ID** (e.g., `R‑TIER‑003`) and document it here.
> - Ensure the rule is **pattern‑based**, supplier‑agnostic, and backed by fixtures/tests.
> - Reference the Rule ID in `docs/PROJECT_PLAN.md` entries and in the EFL review queue notes when resolving quarantined cards.


