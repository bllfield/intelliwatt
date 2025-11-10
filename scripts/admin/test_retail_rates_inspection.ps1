# Test WattBuy Retail Rates Endpoints with Inspection Helper
# Usage: .\scripts\admin\test_retail_rates_inspection.ps1

if (-not $env:ADMIN_TOKEN) {
    Write-Host "ERROR: ADMIN_TOKEN not set. Set it with:" -ForegroundColor Red
    Write-Host '  $env:ADMIN_TOKEN = "your-token"' -ForegroundColor Yellow
    exit 1
}

$headers = @{ "x-admin-token" = $env:ADMIN_TOKEN }
$baseUrl = "https://intelliwatt.com"

Write-Host "`n=== Test 1: Explicit utilityID + state ===" -ForegroundColor Cyan
$uri = "$baseUrl/api/admin/wattbuy/retail-rates-test?utilityID=44372&state=tx"
try {
    $response = Invoke-RestMethod -Uri $uri -Headers $headers -Method GET
    Write-Host "✓ Success" -ForegroundColor Green
    Write-Host "  topType: $($response.topType)"
    Write-Host "  foundListPath: $($response.foundListPath)"
    Write-Host "  count: $($response.count)"
    if ($response.sample) {
        Write-Host "  sample items: $($response.sample.Count)"
    }
    if ($response.note) {
        Write-Host "  note: $($response.note)" -ForegroundColor Yellow
    }
    if ($response.headers) {
        Write-Host "  x-amzn-requestid: $($response.headers.'x-amzn-requestid')"
    }
} catch {
    Write-Host "✗ Error: $($_.Exception.Message)" -ForegroundColor Red
    if ($_.ErrorDetails.Message) {
        Write-Host "  Details: $($_.ErrorDetails.Message)" -ForegroundColor Red
    }
}

Write-Host "`n=== Test 2: By Address (auto-derive utilityID + fallback) ===" -ForegroundColor Cyan
$address = "9514%20Santa%20Paula%20Dr"
$city = "Fort%20Worth"
$state = "tx"
$zip = "76116"
$uri = "$baseUrl/api/admin/wattbuy/retail-rates-by-address?address=$address&city=$city&state=$state&zip=$zip"
try {
    $response = Invoke-RestMethod -Uri $uri -Headers $headers -Method GET
    Write-Host "✓ Success" -ForegroundColor Green
    Write-Host "  status: $($response.status)"
    Write-Host "  topType: $($response.topType)"
    Write-Host "  foundListPath: $($response.foundListPath)"
    Write-Host "  count: $($response.count)"
    if ($response.sample) {
        Write-Host "  sample items: $($response.sample.Count)"
    }
    if ($response.note) {
        Write-Host "  note: $($response.note)" -ForegroundColor Yellow
    }
    if ($response.where) {
        Write-Host "  where (utilityID): $($response.where.utilityID)"
        Write-Host "  where (state): $($response.where.state)"
    }
    if ($response.tried) {
        Write-Host "  tried utilities:" -ForegroundColor Cyan
        foreach ($t in $response.tried) {
            $statusColor = if ($t.status -eq 200) { "Green" } elseif ($t.status -eq 204) { "Yellow" } else { "Red" }
            Write-Host "    - $($t.utilityID) ($($t.utilityName)): status=$($t.status), count=$($t.count)" -ForegroundColor $statusColor
        }
    }
} catch {
    Write-Host "✗ Error: $($_.Exception.Message)" -ForegroundColor Red
    if ($_.ErrorDetails.Message) {
        Write-Host "  Details: $($_.ErrorDetails.Message)" -ForegroundColor Red
    }
}

Write-Host "`n=== Test 3: ZIP-only (auto-derive utilityID + fallback) ===" -ForegroundColor Cyan
$uri = "$baseUrl/api/admin/wattbuy/retail-rates-zip?zip=75201"
try {
    $response = Invoke-RestMethod -Uri $uri -Headers $headers -Method GET
    Write-Host "✓ Success" -ForegroundColor Green
    Write-Host "  status: $($response.status)"
    Write-Host "  topType: $($response.topType)"
    Write-Host "  foundListPath: $($response.foundListPath)"
    Write-Host "  count: $($response.count)"
    if ($response.sample) {
        Write-Host "  sample items: $($response.sample.Count)"
    }
    if ($response.note) {
        Write-Host "  note: $($response.note)" -ForegroundColor Yellow
    }
    if ($response.tried) {
        Write-Host "  tried utilities:" -ForegroundColor Cyan
        foreach ($t in $response.tried) {
            $statusColor = if ($t.status -eq 200) { "Green" } elseif ($t.status -eq 204) { "Yellow" } else { "Red" }
            Write-Host "    - $($t.utilityID) ($($t.utilityName)): status=$($t.status), count=$($t.count)" -ForegroundColor $statusColor
        }
    }
} catch {
    Write-Host "✗ Error: $($_.Exception.Message)" -ForegroundColor Red
    if ($_.ErrorDetails.Message) {
        Write-Host "  Details: $($_.ErrorDetails.Message)" -ForegroundColor Red
    }
}

Write-Host "`n=== Summary ===" -ForegroundColor Cyan
Write-Host "All tests completed. Check the Inspector UI at:" -ForegroundColor Green
Write-Host "  https://intelliwatt.com/admin/wattbuy/inspector" -ForegroundColor Yellow
Write-Host "`nFor detailed inspection metadata, use the UI or check the full JSON responses above." -ForegroundColor Gray

