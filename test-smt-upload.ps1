# Set ADMIN_TOKEN first (get it from Vercel production env vars):
# $env:ADMIN_TOKEN = "H67yOM1l86xhdx/hxXsccLuBxVFhzt+cpnIslUtMiABO6BSvwSGv3/VFQ77fsm84"

$headers = @{ 
  "x-admin-token" = $env:ADMIN_TOKEN
  "Content-Type" = "application/json" 
}
$body = @{
  filename   = "test_adhoc.csv"
  sizeBytes  = 123
  sha256     = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855" # empty file hash ok
  receivedAt = (Get-Date).ToString("o")
} | ConvertTo-Json

try {
  $r = Invoke-RestMethod -Uri "https://intelliwatt.com/api/admin/smt/raw-upload" -Method POST -Headers $headers -Body $body
  $r | ConvertTo-Json -Depth 5
} catch {
  $_.Exception.Response.StatusCode.value__
  ($_ | Out-String)
}
