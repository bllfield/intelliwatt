param(
  [string]$BaseUrl = "https://intelliwatt.com",
  [Parameter(Mandatory = $true)][string]$AdminToken,
  [Parameter(Mandatory = $true)][string]$CsvPath,
  [string]$Esiid = "10443720000000001",
  [string]$Meter = "M1"
)

if (-not (Test-Path -Path $CsvPath)) {
  throw "CSV not found: $CsvPath"
}

$bytes = [System.IO.File]::ReadAllBytes($CsvPath)
$b64   = [Convert]::ToBase64String($bytes)
$size  = $bytes.Length
$fn    = [System.IO.Path]::GetFileName($CsvPath)
$now   = (Get-Date).ToUniversalTime().ToString("o")

$body = @{
  mode        = "inline"
  source      = "adhocusage"
  filename    = $fn
  mime        = "text/csv"
  encoding    = "base64"
  sizeBytes   = $size
  content_b64 = $b64
  esiid       = $Esiid
  meter       = $Meter
  captured_at = $now
} | ConvertTo-Json -Depth 8

$headers = @{
  "x-admin-token" = $AdminToken
  "content-type"  = "application/json"
}

try {
  $resp = Invoke-WebRequest -Method POST -Uri "$BaseUrl/api/admin/smt/pull" -Headers $headers -Body $body
  Write-Host "HTTP:" $resp.StatusCode
  Write-Output $resp.Content
} catch {
  $ex = $_.Exception
  if ($ex.Response) {
    $response = $ex.Response
    $reader = New-Object System.IO.StreamReader($response.GetResponseStream())
    $text = $reader.ReadToEnd()
    Write-Host "HTTP:" ([int]$response.StatusCode)
    Write-Output $text
  } else {
    throw
  }
}
