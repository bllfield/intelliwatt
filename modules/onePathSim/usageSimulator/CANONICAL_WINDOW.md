# Canonical window (single source of truth)

**Rule (one sentence):** The canonical window is the **last 12 full months** ending at the **canonical end month**, where the end month is **(a)** the last full month in America/Chicago when not in manual mode, or **(b)** the manual anchor end month (from `anchorEndDate` or `anchorEndMonth` + `billEndDay`) when in manual mode. All simulator, overlay, and upgrade logic must use this single definition.

**Output:** Full canonical window (12 full months). Day count may be **365 or 366** (or 364 in edge cases) depending on the window; do not assume a fixed "365-day curve".

**Implementation:** `canonicalMonthsForRecalc` in `service.ts` and `canonicalWindow12Months` in `canonicalWindow.ts` derive the 12 months and end month from this rule only. No ad-hoc "12 months" or "end month" logic elsewhere.
