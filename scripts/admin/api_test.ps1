Param(
  [Parameter(Mandatory=$true)][string]$BaseUrl,
  [Parameter(Mandatory=$true)][string]$AdminToken,
  [Parameter(Mandatory=$true)][string]$CronSecret
)

function PP([object]$r) { $r | ConvertTo-Json -Depth 8 }

Write-Host ">> PING (no token)"
$ping = Invoke-RestMethod -Uri "$BaseUrl/api/ping" -SkipHttpErrorCheck -StatusCodeVariable sc
"Status: $sc"; PP $ping

Write-Host "`n>> ENV HEALTH (admin token)"
$envh = Invoke-RestMethod -Uri "$BaseUrl/api/admin/env-health" `
  -Headers @{ "x-admin-token" = $AdminToken } -SkipHttpErrorCheck -StatusCodeVariable sc
"Status: $sc"; PP $envh

Write-Host "`n>> CRON ECHO (cron secret)"
$echo = Invoke-RestMethod -Uri "$BaseUrl/api/admin/ercot/debug/echo-cron" `
  -Headers @{ "x-cron-secret" = $CronSecret } -SkipHttpErrorCheck -StatusCodeVariable sc
"Status: $sc"; PP $echo

Write-Host "`n>> ERCOT CRON (manual trigger)"
$cron = Invoke-RestMethod -Uri "$BaseUrl/api/admin/ercot/cron" `
  -Headers @{ "x-cron-secret" = $CronSecret } -SkipHttpErrorCheck -StatusCodeVariable sc
"Status: $sc"; PP $cron

Write-Host "`n>> WATTBUY PROBE (admin)"
$body = @{ zip5 = "76107"; state = "TX" } | ConvertTo-Json
$probe = Invoke-RestMethod -Method POST -Uri "$BaseUrl/api/admin/wattbuy/probe-offers" `
  -Headers @{ "x-admin-token" = $AdminToken } -ContentType "application/json" `
  -Body $body -SkipHttpErrorCheck -StatusCodeVariable sc
"Status: $sc"; PP $probe

Write-Host "`n>> PUBLIC OFFERS (no token)"
$offers = Invoke-RestMethod -Uri "$BaseUrl/api/offers?zip5=76107" -SkipHttpErrorCheck -StatusCodeVariable sc
"Status: $sc"; PP $offers

Write-Host "`n>> RECENT OFFERS (admin)"
$recent = Invoke-RestMethod -Uri "$BaseUrl/api/admin/offers/recent?limit=25" `
  -Headers @{ "x-admin-token" = $AdminToken } -SkipHttpErrorCheck -StatusCodeVariable sc
"Status: $sc"; PP $recent
