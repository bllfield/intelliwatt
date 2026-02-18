Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Get-ProjectRoot {
  # scripts/admin/Audit-Simulator-Boundaries.ps1 -> repo root is 2 levels up
  return (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
}

function Add-SectionLine([string]$line) {
  $script:sections += $line
}

function Add-BlankLine {
  $script:sections += ""
}

function Run-Search {
  param(
    [Parameter(Mandatory = $true)][string]$Title,
    [Parameter(Mandatory = $true)][string]$Pattern,
    [Parameter(Mandatory = $true)][string[]]$Paths,
    [string[]]$RgArgs = @()
  )

  $output = $null
  try {
    $output = & rg -n @RgArgs $Pattern -- @Paths 2>$null
  } catch {
    $output = $null
  }

  if ($LASTEXITCODE -eq 0 -and $output) {
    Add-SectionLine "## $Title"
    Add-BlankLine
    Add-SectionLine '```'
    foreach ($line in $output) { Add-SectionLine $line }
    Add-SectionLine '```'
    Add-BlankLine
  }
}

function Run-SearchFiltered {
  param(
    [Parameter(Mandatory = $true)][string]$Title,
    [Parameter(Mandatory = $true)][string]$Pattern,
    [Parameter(Mandatory = $true)][string[]]$Paths,
    [Parameter(Mandatory = $true)][ScriptBlock]$KeepLine,
    [string[]]$RgArgs = @()
  )

  $output = $null
  try {
    $output = & rg -n @RgArgs $Pattern -- @Paths 2>$null
  } catch {
    $output = $null
  }

  if ($LASTEXITCODE -eq 0 -and $output) {
    $kept = @()
    foreach ($line in $output) {
      if (& $KeepLine $line) { $kept += $line }
    }
    if ($kept.Count -gt 0) {
      Add-SectionLine "## $Title"
      Add-BlankLine
      Add-SectionLine '```'
      foreach ($line in $kept) { Add-SectionLine $line }
      Add-SectionLine '```'
      Add-BlankLine
    }
  }
}

$repoRoot = Get-ProjectRoot
Set-Location $repoRoot

$reportPath = Join-Path $repoRoot "docs\USAGE_SIMULATOR_BOUNDARY_AUDIT.md"
$script:sections = @()

Add-SectionLine "# Usage Simulator Boundary Audit"
Add-SectionLine "Generated: $(Get-Date -Format u)"
Add-BlankLine
Add-SectionLine "This report is a ripgrep-based heuristic scan for V1 boundary risks:"
Add-SectionLine '- UI should not import `@/modules/**` (except shared types, if any).'
Add-SectionLine '- API routes should be thin controllers; the simulator routes should call `@/modules/usageSimulator/service` rather than pipeline internals.'
Add-BlankLine

# Direct Prisma client imports
Run-Search -Title "Direct Prisma Client Imports (Simulator-related)" `
  -Pattern "from\s+['\""].*(homeDetailsPrisma|appliancesPrisma|usagePrisma|prisma)['\""]" `
  -Paths @("modules/usageSimulator", "app/api/user/simulator", "components/usage")

# Direct prisma calls
Run-Search -Title "Direct prisma.* Calls Inside modules/usageSimulator" `
  -Pattern "\bprisma\." `
  -Paths @("modules/usageSimulator")

# Direct external module prisma client usage
Run-Search -Title "Direct External Prisma Client Usage (homeDetailsPrisma/appliancesPrisma/usagePrisma)" `
  -Pattern "\b(homeDetailsPrisma|appliancesPrisma|usagePrisma)\." `
  -Paths @("modules/usageSimulator", "app/api/user/simulator", "components/usage")

# Direct table name references (cross-module-ish)
Run-Search -Title "Direct Table/Model References (Cross-module touchpoints)" `
  -Pattern "\b(homeProfileSimulated|applianceProfileSimulated|ManualUsageInput|SmtInterval|UsageSimulatorBuild|UsageSimulatorScenario|UsageSimulatorScenarioEvent)\b" `
  -Paths @("modules/usageSimulator")

# Raw DB operations
Run-Search -Title "Raw DB Operations Inside modules/usageSimulator (heuristic)" `
  -Pattern '\b(findFirst|findMany|findUnique|upsert|update|create|delete|aggregate|groupBy|\$queryRaw|\$executeRaw)\b' `
  -Paths @("modules/usageSimulator")

# Guardrail: UI importing modules directly
Run-Search -Title "UI importing @/modules/** (should be empty or type-only)" `
  -Pattern "from\s+['\""]@/modules/" `
  -Paths @("components", "app/dashboard") `
  -RgArgs @("--glob", "*.ts", "--glob", "*.tsx")

# Guardrail: API routes importing modules other than usageSimulator/service
Run-SearchFiltered -Title "API routes importing @/modules/** excluding usageSimulator/service (review)" `
  -Pattern "from\s+['\""]@/modules/" `
  -Paths @("app/api") `
  -RgArgs @("--glob", "**/route.ts", "--glob", "**/route.tsx") `
  -KeepLine {
    param($line)
    return ($line -notmatch "@/modules/usageSimulator/service")
  }

# Guardrail: business-logic keywords inside simulator API routes
Run-Search -Title "Heuristic: Business-logic keywords inside app/api/user/simulator/** (should be empty)" `
  -Pattern "\b(computeMonthlyOverlay|estimateUsageForCanonicalWindow|fetchSmtIntradayShape96|fetchSmtCanonicalMonthlyTotals|generateSimulatedCurve|buildSimulatorInputs|reshapeMonthlyTotalsFromBaseline|computeBuildInputsHash|canonicalWindow12Months)\b" `
  -Paths @("app/api/user/simulator") `
  -RgArgs @("--glob", "**/route.ts", "--glob", "**/route.tsx")

if ($script:sections.Count -le 6) {
  Add-SectionLine "No boundary risks detected based on search patterns."
  Add-BlankLine
}

$script:sections | Out-File -FilePath $reportPath -Encoding UTF8

Write-Host "Boundary audit complete."
Write-Host "Report written to $reportPath"

