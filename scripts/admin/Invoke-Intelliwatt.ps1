param(
  [Parameter(Mandatory=$true)][string]$Uri,
  [ValidateSet('GET','POST','PUT','PATCH','DELETE')][string]$Method = 'GET',
  [Hashtable]$Headers,
  [string]$Body
)

if (-not $env:ADMIN_TOKEN) { throw "ADMIN_TOKEN not set in this session." }

if (-not $Headers) { $Headers = @{} }
$Headers["x-admin-token"] = $env:ADMIN_TOKEN

if ($Body) {
  Invoke-RestMethod -Uri $Uri -Method $Method -Headers $Headers -ContentType 'application/json' -Body $Body
} else {
  Invoke-RestMethod -Uri $Uri -Method $Method -Headers $Headers
}

