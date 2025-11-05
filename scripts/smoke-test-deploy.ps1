# IntelliWatt Smoke Test Script (PowerShell)
# Run as deploy user - tests SMT SFTP, API uploads, WattBuy, and DB endpoints

# ==== run as deploy ====
Write-Host "Running as: $env:USERNAME" -ForegroundColor Cyan

# 0) Vars
$BASE = "https://intelliwatt.com"
$STAMP = (Get-Date -Format "yyyyMMdd_HHmmss" -AsUTC)
$WORK = "/home/deploy/smoke_$STAMP"

# Create work directory
New-Item -ItemType Directory -Force -Path $WORK | Out-Null
Set-Location $WORK
Write-Host "Working directory: $WORK" -ForegroundColor Green

# 1) Load ingest env (for SMT SFTP + local paths)
$envPath = "/home/deploy/smt_ingest/.env"
if (Test-Path $envPath) {
    Get-Content $envPath | ForEach-Object {
        if ($_ -match '^\s*([^#][^=]*)=(.*)$') {
            $key = $matches[1].Trim()
            $value = $matches[2].Trim()
            # Remove quotes if present
            if ($value -match '^["''](.*)["'']$') {
                $value = $matches[1]
            }
            [Environment]::SetEnvironmentVariable($key, $value)
            Write-Host "Loaded: $key" -ForegroundColor DarkGray
        }
    }
} else {
    Write-Warning ".env file not found at $envPath"
}

# Ensure required directories exist
if ($env:INBOUND_DIR) {
    New-Item -ItemType Directory -Force -Path $env:INBOUND_DIR | Out-Null
}
if ($env:LOG_DIR) {
    New-Item -ItemType Directory -Force -Path $env:LOG_DIR | Out-Null
}
if ($env:KNOWN_HOSTS) {
    $knownHostsDir = Split-Path -Parent $env:KNOWN_HOSTS
    if ($knownHostsDir) {
        New-Item -ItemType Directory -Force -Path $knownHostsDir | Out-Null
    }
}

# 2) Get ADMIN token once (hidden input)
$secureToken = Read-Host "Paste ADMIN_TOKEN" -AsSecureString
$ADMIN_TOKEN = [Runtime.InteropServices.Marshal]::PtrToStringAuto(
    [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secureToken)
)

Write-Host ""
Write-Host "======================" -ForegroundColor Yellow
Write-Host "SMT: SFTP -> download 1 file (if present) -> raw-upload to API" -ForegroundColor Yellow
Write-Host "======================" -ForegroundColor Yellow

# Ensure host key + key perms
if ($env:SMT_HOST -and $env:KNOWN_HOSTS) {
    Write-Host "Scanning host keys for $($env:SMT_HOST)..." -ForegroundColor Cyan
    & ssh-keyscan -t rsa,ecdsa,ed25519 "$($env:SMT_HOST)" 2>$null | Add-Content -Path $env:KNOWN_HOSTS -ErrorAction SilentlyContinue
    
    if (Test-Path $env:KNOWN_HOSTS) {
        & chmod 644 $env:KNOWN_HOSTS 2>$null
    }
    if ($env:SSH_KEY -and (Test-Path $env:SSH_KEY)) {
        & chmod 600 $env:SSH_KEY 2>$null
    }
}

# List remote dir to a log
$SFTP_LOG = "$WORK/smt_sftp_list_$STAMP.log"
Write-Host "Listing remote SMT directory..." -ForegroundColor Cyan

$sftpCommands = @"
cd $($env:REMOTE_DIR ?? '/')
ls -la
bye
"@

$sftpCommands | & sftp -oBatchMode=yes `
    -oIdentitiesOnly=yes `
    -oStrictHostKeyChecking=yes `
    -oUserKnownHostsFile=$($env:KNOWN_HOSTS) `
    -oPubkeyAuthentication=yes `
    -oPreferredAuthentications=publickey `
    -oPubkeyAcceptedAlgorithms=+ssh-rsa `
    -oHostKeyAlgorithms=+ssh-rsa `
    -i $($env:SSH_KEY) `
    "$($env:SMT_USER)@$($env:SMT_HOST)" 2>&1 | Out-File -FilePath $SFTP_LOG

Write-Host "---- SMT remote listing (first 30 lines) ----" -ForegroundColor Yellow
Get-Content $SFTP_LOG -TotalCount 30 | Write-Host
Write-Host "--------------------------------------------" -ForegroundColor Yellow

# Find a candidate file name (CSV/ZIP/TXT/XML) from listing
$candidateFiles = Get-Content $SFTP_LOG | 
    Where-Object { $_ -match '\.(csv|zip|txt|xml|gz)$' } | 
    ForEach-Object { 
        if ($_ -match '\s+(\S+\.(csv|zip|txt|xml|gz))$') { 
            $matches[1] 
        } 
    }
$CAND = $candidateFiles | Select-Object -First 1

if ($CAND) {
    Write-Host "Found remote file: $CAND — pulling to $($env:INBOUND_DIR)" -ForegroundColor Green
    
    $pullCommands = @"
cd $($env:REMOTE_DIR ?? '/')
lcd $($env:INBOUND_DIR)
get -p $CAND
bye
"@
    
    $pullLog = "$WORK/smt_pull_$STAMP.log"
    $pullCommands | & sftp -oBatchMode=yes `
        -oIdentitiesOnly=yes `
        -oStrictHostKeyChecking=yes `
        -oUserKnownHostsFile=$($env:KNOWN_HOSTS) `
        -oPubkeyAuthentication=yes `
        -oPreferredAuthentications=publickey `
        -oPubkeyAcceptedAlgorithms=+ssh-rsa `
        -oHostKeyAlgorithms=+ssh-rsa `
        -i $($env:SSH_KEY) `
        "$($env:SMT_USER)@$($env:SMT_HOST)" 2>&1 | Out-File -FilePath $pullLog
    
    $TESTFILE = Join-Path $env:INBOUND_DIR (Split-Path -Leaf $CAND)
    
    if (Test-Path $TESTFILE) {
        $fileInfo = Get-Item $TESTFILE
        $SIZE = $fileInfo.Length
        $hashObj = Get-FileHash -Path $TESTFILE -Algorithm SHA256
        $HASH = $hashObj.Hash.ToLower()
        Write-Host "Pulled $TESTFILE ($SIZE bytes, SHA256: $HASH)" -ForegroundColor Green
    } else {
        Write-Warning "Could not find downloaded file locally — continuing with API ping tests only."
        $TESTFILE = $null
    }
} else {
    Write-Host "NOTE: No obvious file found to pull — continuing with API ping tests only." -ForegroundColor Yellow
    $TESTFILE = $null
}

# If we have a local file, hit raw-upload to verify API write-path
if ($TESTFILE -and (Test-Path $TESTFILE)) {
    Write-Host ""
    Write-Host "== Hitting /api/admin/smt/raw-upload with metadata ==" -ForegroundColor Cyan
    
    $RFC3339 = (Get-Date -Format "yyyy-MM-ddTHH:mm:ssZ" -AsUTC)
    
    $uploadBody = @{
        filename   = (Split-Path -Leaf $TESTFILE)
        sizeBytes  = $SIZE
        sha256     = $HASH
        receivedAt = $RFC3339
    } | ConvertTo-Json
    
    $headers = @{
        "x-admin-token" = $ADMIN_TOKEN
        "Content-Type"  = "application/json"
    }
    
    try {
        $uploadResponse = Invoke-RestMethod -Uri "$BASE/api/admin/smt/raw-upload" `
            -Method POST `
            -Headers $headers `
            -Body $uploadBody `
            -ErrorAction Stop
        
        $uploadResponse | ConvertTo-Json -Depth 5 | 
            Tee-Object -FilePath "$WORK/smt_raw_upload_resp.json" | 
            Write-Host
    } catch {
        Write-Error "Upload failed: $($_.Exception.Message)"
        $_.Exception.Response | Out-File -FilePath "$WORK/smt_raw_upload_error.json"
    }
} else {
    Write-Host "SKIP raw-upload (no local test file)." -ForegroundColor Yellow
}

Write-Host ""
Write-Host "======================" -ForegroundColor Yellow
Write-Host "WattBuy: ping + sample offers request (via your API admin routes)" -ForegroundColor Yellow
Write-Host "======================" -ForegroundColor Yellow

$headers = @{
    "x-admin-token" = $ADMIN_TOKEN
}

Write-Host ""
Write-Host "== WattBuy admin ping ==" -ForegroundColor Cyan
try {
    $wattbuyPing = Invoke-RestMethod -Uri "$BASE/api/admin/wattbuy/ping" `
        -Headers $headers `
        -ErrorAction Stop
    
    $wattbuyPing | ConvertTo-Json -Depth 5 | 
        Tee-Object -FilePath "$WORK/wattbuy_ping.json" | 
        Write-Host
} catch {
    Write-Error "WattBuy ping failed: $($_.Exception.Message)"
}

Write-Host ""
Write-Host "== WattBuy sample offers (Dallas ZIP 75201, 2000 kWh/mo, 12 mo) ==" -ForegroundColor Cyan
try {
    $wattbuyOffers = Invoke-RestMethod -Uri "$BASE/api/admin/wattbuy/offers?zip=75201&monthly_kwh=2000&term=12" `
        -Headers $headers `
        -ErrorAction Stop
    
    $wattbuyOffers | ConvertTo-Json -Depth 5 | 
        Tee-Object -FilePath "$WORK/wattbuy_offers.json" | 
        Write-Host
} catch {
    Write-Error "WattBuy offers failed: $($_.Exception.Message)"
}

Write-Host ""
Write-Host "======================" -ForegroundColor Yellow
Write-Host "DB smoke: show last 5 rows from expected tables via your health endpoints (if present)" -ForegroundColor Yellow
Write-Host "======================" -ForegroundColor Yellow

Write-Host ""
Write-Host "== Results snapshot endpoints (if implemented) ==" -ForegroundColor Cyan

Write-Host ""
Write-Host "-- SMT recent raw files --" -ForegroundColor Cyan
try {
    $smtRawFiles = Invoke-RestMethod -Uri "$BASE/api/admin/debug/smt/raw-files?limit=5" `
        -Headers $headers `
        -ErrorAction Stop
    
    $smtRawFiles | ConvertTo-Json -Depth 5 | 
        Tee-Object -FilePath "$WORK/smt_raw_files.json" | 
        Write-Host
} catch {
    Write-Warning "SMT raw files endpoint not available: $($_.Exception.Message)"
}

Write-Host ""
Write-Host "-- WattBuy recent quotes --" -ForegroundColor Cyan
try {
    $wattbuyQuotes = Invoke-RestMethod -Uri "$BASE/api/admin/debug/wattbuy/quotes?limit=5" `
        -Headers $headers `
        -ErrorAction Stop
    
    $wattbuyQuotes | ConvertTo-Json -Depth 5 | 
        Tee-Object -FilePath "$WORK/wattbuy_quotes.json" | 
        Write-Host
} catch {
    Write-Warning "WattBuy quotes endpoint not available: $($_.Exception.Message)"
}

Write-Host ""
Write-Host "== DONE ==" -ForegroundColor Green
Write-Host "Artifacts in: $WORK" -ForegroundColor Green

