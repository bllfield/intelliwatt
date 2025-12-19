param(
  [Parameter(Mandatory=$true)][string]$Uri,
  [ValidateSet('GET','POST','PUT','PATCH','DELETE')][string]$Method = 'GET',
  [Hashtable]$Headers,
  [string]$Body,
  # Optional: pass token explicitly instead of relying on session env vars.
  [string]$AdminToken
)

function Get-ProjectRoot {
  # scripts/admin/Invoke-Intelliwatt.ps1 -> repo root is 2 levels up from this script directory
  return (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
}

function TryReadDotenvValue([string]$filePath, [string]$key) {
  if (-not (Test-Path $filePath)) { return $null }
  try {
    $lines = Get-Content -LiteralPath $filePath -ErrorAction Stop
    foreach ($line in $lines) {
      # Skip comments and empty lines
      if ($line -match '^\s*#') { continue }
      if ($line -match "^\s*$key\s*=\s*(.+)\s*$") {
        $raw = $Matches[1].Trim()
        # Strip surrounding quotes if present
        if (($raw.StartsWith('"') -and $raw.EndsWith('"')) -or ($raw.StartsWith("'") -and $raw.EndsWith("'"))) {
          return $raw.Substring(1, $raw.Length - 2)
        }
        return $raw
      }
    }
  } catch {
    return $null
  }
  return $null
}

function Resolve-AdminToken([string]$explicitToken) {
  if ($explicitToken) { return $explicitToken }
  if ($env:ADMIN_TOKEN) { return $env:ADMIN_TOKEN }

  # Common fallbacks some people use locally (non-authoritative).
  if ($env:INTELLIWATT_ADMIN_TOKEN) { return $env:INTELLIWATT_ADMIN_TOKEN }
  if ($env:IW_ADMIN_TOKEN) { return $env:IW_ADMIN_TOKEN }

  # Best-effort: read from local dotenv files if you keep it there (do NOT commit).
  $root = Get-ProjectRoot
  $candidates = @(
    (Join-Path $root ".env.local"),
    (Join-Path $root ".env.production.local"),
    (Join-Path $root ".env")
  )
  foreach ($p in $candidates) {
    $v = TryReadDotenvValue -filePath $p -key "ADMIN_TOKEN"
    if ($v) {
      # Populate session for subsequent calls in this PowerShell window.
      $env:ADMIN_TOKEN = $v
      return $v
    }
  }
  return $null
}

$resolvedToken = Resolve-AdminToken -explicitToken $AdminToken
if (-not $resolvedToken) {
  throw @"
ADMIN_TOKEN not set for this PowerShell session.

Fix (recommended):
  `$env:ADMIN_TOKEN = "<YOUR_ADMIN_TOKEN>"

Or pass token directly:
  .\scripts\admin\Invoke-Intelliwatt.ps1 -Uri "<url>" -AdminToken "<YOUR_ADMIN_TOKEN>"

Note: Vercel env vars do not automatically apply to your local PowerShell session.
"@
}

if (-not $Headers) { $Headers = @{} }
$Headers["x-admin-token"] = $resolvedToken

if ($Body) {
  Invoke-RestMethod -Uri $Uri -Method $Method -Headers $Headers -ContentType 'application/json' -Body $Body
} else {
  Invoke-RestMethod -Uri $Uri -Method $Method -Headers $Headers
}

