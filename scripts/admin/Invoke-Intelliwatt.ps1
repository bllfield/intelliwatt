<#
.SYNOPSIS
  Wrapper for calling IntelliWatt admin/debug endpoints with x-admin-token automatically.

.DESCRIPTION
  - Reads ADMIN_TOKEN from the current PowerShell session env var ($env:ADMIN_TOKEN).
  - Injects header 'x-admin-token' on every request.
  - Works for GET/POST/PUT/PATCH/DELETE.
  - Keeps secrets out of the repo; you set ADMIN_TOKEN locally or in CI.

.EXAMPLE
  # Set your token for this session (do not commit)
  $env:ADMIN_TOKEN = '<YOUR_TOKEN>'

  # GET list-all-addresses in Production
  .\scripts\admin\Invoke-Intelliwatt.ps1 -Uri 'https://intelliwatt.com/api/debug/list-all-addresses'

  # GET on Preview
  .\scripts\admin\Invoke-Intelliwatt.ps1 -Uri 'https://<your-preview>.vercel.app/api/debug/check-address?email=bllfield@yahoo.com'

  # POST cleanup
  .\scripts\admin\Invoke-Intelliwatt.ps1 -Uri 'https://<your-env>.vercel.app/api/debug/cleanup' -Method POST
#>
param(
  [Parameter(Mandatory=$true)][string]$Uri,
  [ValidateSet('GET','POST','PUT','PATCH','DELETE')][string]$Method = 'GET',
  [hashtable]$Headers,
  [object]$Body,
  [int]$TimeoutSec = 90
)

if (-not $env:ADMIN_TOKEN -or [string]::IsNullOrWhiteSpace($env:ADMIN_TOKEN)) {
  Write-Error "ADMIN_TOKEN is not set in this PowerShell session. Set it with: `$env:ADMIN_TOKEN = '<your token>'" -ForegroundColor Red
  exit 1
}

$mergedHeaders = @{'x-admin-token' = $env:ADMIN_TOKEN}
if ($Headers) {
  foreach ($k in $Headers.Keys) { $mergedHeaders[$k] = $Headers[$k] }
}

$invokeParams = @{
  Uri         = $Uri
  Method      = $Method
  Headers     = $mergedHeaders
  ErrorAction = 'Stop'
  TimeoutSec  = $TimeoutSec
}

if ($Body) {
  if ($Body -is [string]) {
    $invokeParams.Body = $Body
    $invokeParams.ContentType = 'application/json'
  } else {
    $invokeParams.Body = ($Body | ConvertTo-Json -Depth 10)
    $invokeParams.ContentType = 'application/json'
  }
}

try {
  $resp = Invoke-RestMethod @invokeParams
  $resp | ConvertTo-Json -Depth 10
} catch {
  Write-Host "❌ Request failed" -ForegroundColor Red
  if ($_.Exception.Response) {
    try {
      $status = $_.Exception.Response.StatusCode.value__
      Write-Host ("HTTP Status: {0}" -f $status) -ForegroundColor Red
      $reader = New-Object System.IO.StreamReader($_.Exception.Response.GetResponseStream())
      $body   = $reader.ReadToEnd()
      if ($body) { Write-Host "Response Body:`n$body" }
    } catch { }
  } else {
    Write-Host $_
  }
  exit 1
}

