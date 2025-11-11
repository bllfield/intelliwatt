Param(
  [Parameter(Mandatory=$true)][string]$BaseUrl,
  [string]$Address = "9514 Santa Paula Dr",
  [string]$City = "Fort Worth",
  [string]$State = "tx",
  [string]$Zip = "76116"
)
function PP([object]$r) { $r | ConvertTo-Json -Depth 10 }
Write-Host ">> PROPERTY BUNDLE (electricity → SMT kick → offers)"
$u = "$BaseUrl/api/admin/wattbuy/property-bundle?address=$([uri]::EscapeDataString($Address))&city=$([uri]::EscapeDataString($City))&state=$State&zip=$Zip"
$res = Invoke-RestMethod -Uri $u -SkipHttpErrorCheck -StatusCodeVariable sc
"Status: $sc"; PP $res
Write-Host "`n>> OFFERS BY ADDRESS (all=true)"
$u2 = "$BaseUrl/api/admin/wattbuy/offers-by-address?address=$([uri]::EscapeDataString($Address))&city=$([uri]::EscapeDataString($City))&state=$State&zip=$Zip&all=true"
$res2 = Invoke-RestMethod -Uri $u2 -SkipHttpErrorCheck -StatusCodeVariable sc
"Status: $sc"; PP $res2

