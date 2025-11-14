param(
    [Parameter(Mandatory = $true)]
    [string]$FilePath,

    [Parameter(Mandatory = $true)]
    [string]$DropletHost,

    [string]$DropletUser = "deploy",

    [string]$RemoteInbox = "/home/deploy/smt_inbox",

    [string]$ServiceName = "smt-ingest.service"
)

Write-Host "=== IntelliWatt · Upload SMT CSV to Droplet ===" -ForegroundColor Cyan

if (-not (Test-Path -Path $FilePath)) {
    Write-Error "File not found: $FilePath"
    exit 1
}

$fullPath  = (Resolve-Path $FilePath).Path
$fileName  = [System.IO.Path]::GetFileName($fullPath)
$remotePath = "$RemoteInbox/$fileName"
$remoteTarget = ('{0}@{1}:"{2}"' -f $DropletUser, $DropletHost, $remotePath)

Write-Host "Source file : $fullPath"
Write-Host "Droplet host: $DropletHost"
Write-Host "Remote path : $remotePath"
Write-Host ""

# Copy the CSV to the droplet SMT inbox
Write-Host "Copying file to droplet inbox via scp..." -ForegroundColor Yellow
scp $fullPath $remoteTarget
if ($LASTEXITCODE -ne 0) {
    Write-Error "scp failed with exit code $LASTEXITCODE. Check SSH/scp setup and try again."
    exit $LASTEXITCODE
}

Write-Host "File copied successfully." -ForegroundColor Green
Write-Host ""

# Trigger the SMT ingest service
Write-Host "Starting SMT ingest service on droplet ($ServiceName)..." -ForegroundColor Yellow
ssh "$DropletUser@$DropletHost" "sudo systemctl start $ServiceName"
if ($LASTEXITCODE -ne 0) {
    Write-Error "Failed to start $ServiceName on droplet. Check systemd logs."
    exit $LASTEXITCODE
}

Write-Host "SMT ingest service triggered." -ForegroundColor Green
Write-Host ""
Write-Host "Next steps:" -ForegroundColor Cyan
Write-Host " - Wait a short moment for the service to process the new file."
Write-Host " - Visit https://intelliwatt.com/admin/smt/raw to confirm a new RawSmtFile row exists."
Write-Host " - Use SMT admin tools to inspect/normalize as needed."

