# Gap-Fill Parity (Crash-Safe)

This runbook avoids Cursor crashes from huge terminal output.

It uses one script that:
- pulls required payloads,
- writes JSON/CSV files to disk,
- prints only one short `OK:` line.

## Where to run

Run in **PowerShell**, from repo root:

`C:\Users\bllfi\Documents\Intellipath Solutions\Intelliwatt Website\intelliwatt-clean`

## Command (default, safest)

```powershell
.\scripts\admin\Run-GapfillParityCrashSafe.ps1 -Email 'brian@intellipath-solutions.com'
```

## Optional: include live compare attempt payload

Only use this if needed. It captures the response into a file (including non-200 status) without dumping large output.

```powershell
$env:ADMIN_TOKEN = '<YOUR_ADMIN_TOKEN>'
.\scripts\admin\Run-GapfillParityCrashSafe.ps1 `
  -Email 'brian@intellipath-solutions.com' `
  -IncludeLiveCompareAttempt `
  -CompareDate '2025-07-15'
```

## Output files

Written to `tmp/parity/`:
- `past.json`
- `gapfill_rebuild_only.json`
- `gapfill_window.json`
- `gapfill_compare_attempt.json` (only when `-IncludeLiveCompareAttempt`)
- `parity_report.json`
- `parity_rows.csv`

## What this protects against

- No giant object dumps in terminal
- No `ConvertTo-Json` streaming to screen
- No repeated manual command chain

## Quick read of results

- Open `tmp/parity/parity_report.json` for:
  - payload sources,
  - coverage checks,
  - exclusion-scope checks,
  - first divergence (if any),
  - full row-level parity.
- Open `tmp/parity/parity_rows.csv` for the strict date-by-date diff table.

