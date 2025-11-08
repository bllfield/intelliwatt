Param(
  [Parameter(Mandatory=$true)][string]$AdminToken,
  [Parameter(Mandatory=$true)][string]$BaseUrl,
  [Parameter(Mandatory=$true)][string]$Zip5,
  [string]$City = "",
  [string]$State = "TX"
)
$Headers = @{ "x-admin-token" = $AdminToken }

Write-Host "== WattBuy Offers Smoke (PS) =="
Write-Host "Base: $BaseUrl"
Write-Host "ZIP:  $Zip5"
if ($City) { Write-Host "City: $City" }
Write-Host "State: $State"

# 1) Probe (admin)
try {
  $probeBody = @{ zip5 = $Zip5; city = $City; state = $State }
  $probeJson = $probeBody | ConvertTo-Json
  $probe = Invoke-RestMethod -Method POST -Uri "$BaseUrl/api/admin/wattbuy/probe-offers" -Headers $Headers -Body $probeJson -ContentType "application/json"
  Write-Host "`n[PROBE]"
  $probe | ConvertTo-Json -Depth 8
} catch {
  Write-Warning "Probe error: $($_.Exception.Message)"
}

# 2) Public offers route (the one UI uses)
try {
  $offers = Invoke-RestMethod -Method GET -Uri "$BaseUrl/api/offers?zip5=$Zip5&city=$City&state=$State"
  Write-Host "`n[OFFERS]"
  $offers | ConvertTo-Json -Depth 8
} catch {
  Write-Warning "Offers error: $($_.Exception.Message)"
}

# 3) Optional: hit your admin listing (if you persist offers)
# Invoke-RestMethod -Method GET -Uri "$BaseUrl/api/admin/offers/recent" -Headers $Headers

