param(
  [Parameter(Mandatory = $true)][string]$Email,
  [string]$OutDir = "tmp/parity",
  [string]$Timezone = "America/Chicago",
  [string]$CompareDate = "2025-07-15",
  [switch]$IncludeLiveCompareAttempt
)

$ErrorActionPreference = "Stop"

function Write-JsonNoBom([string]$Path, $Object) {
  $json = $Object | ConvertTo-Json -Depth 100
  $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
  [System.IO.File]::WriteAllText($Path, $json, $utf8NoBom)
}

function Write-TextNoBom([string]$Path, [string]$Text) {
  $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
  [System.IO.File]::WriteAllText($Path, $Text, $utf8NoBom)
}

function Read-Json([string]$Path) {
  $raw = [System.IO.File]::ReadAllText($Path)
  $trimmed = $raw.TrimStart([char]0xFEFF)
  return $trimmed | ConvertFrom-Json
}

function DateKey([datetime]$d) {
  return $d.ToString("yyyy-MM-dd")
}

function Build-DateRangeKeys([string]$StartDate, [string]$EndDate) {
  $out = New-Object System.Collections.Generic.List[string]
  $d = [datetime]::ParseExact($StartDate, "yyyy-MM-dd", $null)
  $end = [datetime]::ParseExact($EndDate, "yyyy-MM-dd", $null)
  while ($d -le $end) {
    $out.Add((DateKey $d))
    $d = $d.AddDays(1)
  }
  return $out
}

New-Item -ItemType Directory -Force -Path $OutDir | Out-Null

$invokeScript = "./scripts/admin/Invoke-Intelliwatt.ps1"

# 1) Pull payloads with minimal terminal output.
$past = & $invokeScript -Uri "https://intelliwatt.com/api/admin/simulation-engines?email=$Email&scenario=past&includeSeries=true&includeDayDiagnostics=false"
Write-JsonNoBom -Path (Join-Path $OutDir "past.json") -Object $past

$rebuildBody = @{
  email = $Email
  timezone = $Timezone
  testDays = 21
  testMode = "fixed"
  minDayCoveragePct = 0.95
  stratifyByMonth = $true
  stratifyByWeekend = $true
  weatherKind = "ACTUAL_LAST_YEAR"
  includeUsage365 = $false
  rebuildArtifact = $true
  rebuildOnly = $true
}
$rebuild = & $invokeScript -Uri "https://intelliwatt.com/api/admin/tools/gapfill-lab" -Method POST -Body ($rebuildBody | ConvertTo-Json -Depth 8 -Compress)
Write-JsonNoBom -Path (Join-Path $OutDir "gapfill_rebuild_only.json") -Object $rebuild

$windowBody = @{
  email = $Email
  timezone = $Timezone
  includeUsage365 = $true
}
$window = & $invokeScript -Uri "https://intelliwatt.com/api/admin/tools/gapfill-lab" -Method POST -Body ($windowBody | ConvertTo-Json -Depth 6 -Compress)
Write-JsonNoBom -Path (Join-Path $OutDir "gapfill_window.json") -Object $window

$compareStatus = $null
$compareObj = $null
if ($IncludeLiveCompareAttempt) {
  $adminToken = $env:ADMIN_TOKEN
  if (-not $adminToken) {
    throw "ADMIN_TOKEN is required for -IncludeLiveCompareAttempt. Set it in the current PowerShell session."
  }

  $compareBody = @{
    email = $Email
    timezone = $Timezone
    includeUsage365 = $false
    rebuildArtifact = $true
    testRanges = @(
      @{
        startDate = $CompareDate
        endDate = $CompareDate
      }
    )
  } | ConvertTo-Json -Depth 8 -Compress

  try {
    $resp = Invoke-WebRequest `
      -Uri "https://intelliwatt.com/api/admin/tools/gapfill-lab" `
      -Method POST `
      -Headers @{ "x-admin-token" = $adminToken } `
      -ContentType "application/json" `
      -Body $compareBody

    $compareStatus = [int]$resp.StatusCode
    $compareObj = [pscustomobject]@{
      status = $compareStatus
      body = ($resp.Content | ConvertFrom-Json)
    }
  } catch {
    $resp = $_.Exception.Response
    if ($null -ne $resp) {
      $status = [int]$resp.StatusCode
      $stream = $resp.GetResponseStream()
      $reader = New-Object System.IO.StreamReader($stream)
      $bodyText = $reader.ReadToEnd()
      $bodyObj = $null
      try { $bodyObj = $bodyText | ConvertFrom-Json } catch { $bodyObj = [pscustomobject]@{ raw = $bodyText } }
      $compareStatus = $status
      $compareObj = [pscustomobject]@{
        status = $status
        body = $bodyObj
      }
    } else {
      $compareStatus = -1
      $compareObj = [pscustomobject]@{
        status = -1
        body = [pscustomobject]@{ error = "request_failed"; detail = ($_ | Out-String) }
      }
    }
  }
  Write-JsonNoBom -Path (Join-Path $OutDir "gapfill_compare_attempt.json") -Object $compareObj
}

# 2) Build strict travel-day parity report.
$pastJson = Read-Json (Join-Path $OutDir "past.json")
$rebuildJson = Read-Json (Join-Path $OutDir "gapfill_rebuild_only.json")
$windowJson = Read-Json (Join-Path $OutDir "gapfill_window.json")

$windowStart = [string]$windowJson.usage365.coverageStart
$windowEnd = [string]$windowJson.usage365.coverageEnd
$windowStartDt = [datetime]::ParseExact($windowStart, "yyyy-MM-dd", $null)
$windowEndDt = [datetime]::ParseExact($windowEnd, "yyyy-MM-dd", $null)

$travelSet = New-Object System.Collections.Generic.HashSet[string]
foreach ($r in @($rebuildJson.travelRangesFromDb)) {
  foreach ($dk in (Build-DateRangeKeys -StartDate ([string]$r.startDate) -EndDate ([string]$r.endDate)) ) {
    $d = [datetime]::ParseExact($dk, "yyyy-MM-dd", $null)
    if ($d -ge $windowStartDt -and $d -le $windowEndDt) {
      [void]$travelSet.Add($dk)
    }
  }
}
$travelDates = @($travelSet) | Sort-Object

$pastDailyByDate = @{}
foreach ($row in @($pastJson.result.dataset.daily)) {
  $dk = [string]$row.date
  if ($dk.Length -ge 10) { $dk = $dk.Substring(0, 10) }
  $pastDailyByDate[$dk] = [double]($row.kwh)
}

$gapfillChartByDate = @{}
$chartSource = "past_daily_fallback"
if ($IncludeLiveCompareAttempt -and $compareStatus -eq 200 -and $null -ne $compareObj.body.diagnostics.dailyTotalsChartSim) {
  foreach ($row in @($compareObj.body.diagnostics.dailyTotalsChartSim)) {
    $dk = [string]$row.date
    if ($dk.Length -ge 10) { $dk = $dk.Substring(0, 10) }
    $gapfillChartByDate[$dk] = [double]($row.simKwh)
  }
  $chartSource = "live_gapfill_compare_payload"
} else {
  foreach ($k in $pastDailyByDate.Keys) { $gapfillChartByDate[$k] = $pastDailyByDate[$k] }
}

$rows = New-Object System.Collections.Generic.List[object]
$firstDivergence = $null
foreach ($dk in $travelDates) {
  $pastVal = if ($pastDailyByDate.ContainsKey($dk)) { $pastDailyByDate[$dk] } else { $null }
  $gapVal = if ($gapfillChartByDate.ContainsKey($dk)) { $gapfillChartByDate[$dk] } else { $null }
  $delta = if ($null -eq $pastVal -or $null -eq $gapVal) { $null } else { [math]::Round(($pastVal - $gapVal), 6) }

  $row = [pscustomobject]@{
    date = $dk
    pastSimDayKwh = $pastVal
    gapfillChartSimDayKwh = $gapVal
    delta = $delta
  }
  $rows.Add($row)
  if ($null -eq $firstDivergence -and $null -ne $delta -and [math]::Abs($delta) -gt 0.0000001) {
    $firstDivergence = $row
  }
}

$travelFingerprint = ($travelDates -join ",")
$pastMeta = $pastJson.result.dataset.meta
$sameScope = (($pastMeta.excludedDateKeysCount -as [int]) -eq $travelDates.Count) -and ([string]$pastMeta.excludedDateKeysFingerprint -eq $travelFingerprint)

$report = [pscustomobject]@{
  payloadSources = [pscustomobject]@{
    past = "tmp/parity/past.json (GET /api/admin/simulation-engines scenario=past)"
    gapfillRebuildOnly = "tmp/parity/gapfill_rebuild_only.json (POST /api/admin/tools/gapfill-lab rebuild_only)"
    gapfillWindow = "tmp/parity/gapfill_window.json (POST /api/admin/tools/gapfill-lab includeUsage365=true)"
    gapfillCompare = if ($IncludeLiveCompareAttempt) { "tmp/parity/gapfill_compare_attempt.json" } else { "not_captured" }
  }
  chartSourceUsed = $chartSource
  houseId = [string]$pastJson.selection.houseId
  pastScenarioId = [string]$pastJson.selection.scenarioId
  pastScenarioName = [string]$pastJson.selection.scenarioName
  pastInputHash = [string]$pastMeta.cacheKeyDiag.inputHash
  coverage = [pscustomobject]@{
    pastStart = [string]$pastJson.result.dataset.summary.start
    pastEnd = [string]$pastJson.result.dataset.summary.end
    gapfillStart = $windowStart
    gapfillEnd = $windowEnd
    sameCoverageWindow = ([string]$pastJson.result.dataset.summary.start -eq $windowStart -and [string]$pastJson.result.dataset.summary.end -eq $windowEnd)
  }
  travelOnlyScope = [pscustomobject]@{
    pastExcludedDateKeysCount = [int]$pastMeta.excludedDateKeysCount
    travelDateKeysCount = $travelDates.Count
    sameTravelOnlyExclusionScope = $sameScope
  }
  travelDatesCompared = $travelDates
  parityExact = ($null -eq $firstDivergence)
  firstDivergence = $firstDivergence
  rows = $rows
}

Write-JsonNoBom -Path (Join-Path $OutDir "parity_report.json") -Object $report

$csv = New-Object System.Collections.Generic.List[string]
$csv.Add("date,pastSimDayKwh,gapfillChartSimDayKwh,delta")
foreach ($r in $rows) {
  $csv.Add(("{0},{1},{2},{3}" -f $r.date, $r.pastSimDayKwh, $r.gapfillChartSimDayKwh, $r.delta))
}
Write-TextNoBom -Path (Join-Path $OutDir "parity_rows.csv") -Text ($csv -join "`n")

Write-Output ("OK: wrote {0}, {1}, {2}" -f (Join-Path $OutDir "parity_report.json"), (Join-Path $OutDir "parity_rows.csv"), (Join-Path $OutDir "past.json"))
