Param(
  [Parameter(Mandatory=$true)] [string] $AdminToken,
  [Parameter(Mandatory=$true)] [string] $CronSecret,
  [string] $BaseUrl = "https://intelliwatt.com",
  [string] $ManualFileUrl = ""
)

Write-Host "== ERCOT Smoke (PowerShell) =="
Write-Host "Base: $BaseUrl"

try {
  $cronResp = Invoke-RestMethod -Method GET -Uri "$BaseUrl/api/admin/ercot/cron" -Headers @{ "x-cron-secret" = $CronSecret }
  Write-Host "`n[CRON] Response:"; $cronResp | ConvertTo-Json -Depth 6
} catch {
  Write-Warning "Cron error: $($_.Exception.Message)"
}

try {
  $ingests = Invoke-RestMethod -Method GET -Uri "$BaseUrl/api/admin/ercot/ingests" -Headers @{ "x-admin-token" = $AdminToken }
  Write-Host "`n[INGESTS]:"; $ingests | ConvertTo-Json -Depth 6
} catch {
  Write-Warning "Ingests error: $($_.Exception.Message)"
}

if ($ManualFileUrl -ne "") {
  try {
    $enc = [System.Web.HttpUtility]::UrlEncode($ManualFileUrl)
    $url = "$BaseUrl/api/admin/ercot/fetch-latest?url=$enc&notes=manual%20smoke"
    $manual = Invoke-RestMethod -Method POST -Uri $url -Headers @{ "x-admin-token" = $AdminToken }
    Write-Host "`n[MANUAL FETCH]:"; $manual | ConvertTo-Json -Depth 6
  } catch {
    Write-Warning "Manual fetch error: $($_.Exception.Message)"
  }
}
