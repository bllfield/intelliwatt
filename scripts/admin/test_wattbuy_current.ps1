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

# --------- WATTBUY (current) ---------

$addr = "9514 Santa Paula Dr"
$city = "Fort Worth"
$state = "tx"
$zip = "76116"

Write-Host "`n>> WATTBUY ELECTRICITY (robust)"
$elec = Invoke-RestMethod -Uri "$BaseUrl/api/admin/wattbuy/electricity-probe?address=$([uri]::EscapeDataString($addr))&city=$([uri]::EscapeDataString($city))&state=$state&zip=$zip" `
  -Headers @{ "x-admin-token" = $AdminToken } -SkipHttpErrorCheck -StatusCodeVariable sc
"Status: $sc"; PP $elec

# NOTE: electricity-save endpoint does not exist yet - uncomment when implemented
# Write-Host "`n>> WATTBUY ELECTRICITY SAVE (persists snapshot)"
# $save = Invoke-RestMethod -Uri "$BaseUrl/api/admin/wattbuy/electricity-save?address=$([uri]::EscapeDataString($addr))&city=$([uri]::EscapeDataString($city))&state=$state&zip=$zip" `
#   -Headers @{ "x-admin-token" = $AdminToken } -SkipHttpErrorCheck -StatusCodeVariable sc
# "Status: $sc"; PP $save

Write-Host "`n>> RETAIL RATES (explicit Oncor 44372)"
$rates1 = Invoke-RestMethod -Uri "$BaseUrl/api/admin/wattbuy/retail-rates-test?utilityID=44372&state=tx" `
  -Headers @{ "x-admin-token" = $AdminToken } -SkipHttpErrorCheck -StatusCodeVariable sc
"Status: $sc"; PP $rates1

Write-Host "`n>> RETAIL RATES (by address w/ alternates)"
$rates2 = Invoke-RestMethod -Uri "$BaseUrl/api/admin/wattbuy/retail-rates-by-address?address=$([uri]::EscapeDataString($addr))&city=$([uri]::EscapeDataString($city))&state=$state&zip=$zip" `
  -Headers @{ "x-admin-token" = $AdminToken } -SkipHttpErrorCheck -StatusCodeVariable sc
"Status: $sc"; PP $rates2

Write-Host "`n>> RETAIL RATES (zip auto-derive)"
$rates3 = Invoke-RestMethod -Uri "$BaseUrl/api/admin/wattbuy/retail-rates-zip?zip=75201" `
  -Headers @{ "x-admin-token" = $AdminToken } -SkipHttpErrorCheck -StatusCodeVariable sc
"Status: $sc"; PP $rates3

