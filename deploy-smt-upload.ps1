# Deploy updated SMT upload server to droplet

$DROPLET_IP = "68.183.139.231"
$REPO_PATH = "/root/intelliwatt"

Write-Host "Deploying SMT upload server to droplet..." -ForegroundColor Cyan

# Copy the updated JavaScript file to the droplet
Write-Host "`nCopying smt-upload-server.js..." -ForegroundColor Yellow
scp scripts/droplet/smt-upload-server.js root@${DROPLET_IP}:${REPO_PATH}/scripts/droplet/

# Restart the service
Write-Host "`nRestarting smt-upload-server service..." -ForegroundColor Yellow
ssh root@${DROPLET_IP} "systemctl restart smt-upload-server"

# Check status
Write-Host "`nChecking service status..." -ForegroundColor Yellow
ssh root@${DROPLET_IP} "systemctl status smt-upload-server --no-pager -l"

Write-Host "`nDeployment complete!" -ForegroundColor Green
Write-Host "Monitor logs with: ssh root@68.183.139.231 'journalctl -u smt-upload-server -f'"
