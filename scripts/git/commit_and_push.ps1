Param(
  [string]$FilePath = "app/api/admin/smt/pull/route.ts",
  [string]$Message  = "feat(smt): add inline content_b64 handler (echo sha256/sizeBytes)"
)

$ErrorActionPreference = 'Stop'

function Step($m){ Write-Host "==> $m" -ForegroundColor Cyan }

Step "Status"
git status

Step "Ensure repo"
git rev-parse --is-inside-work-tree | Out-Null

Step "Switch to main"
try {
  git switch main
} catch {
  Write-Host "Stashing to switch..." -ForegroundColor Yellow
  git stash push -u -m "cursor-auto-stash: commit-push"
  git switch main
  Write-Host "Restoring stash..." -ForegroundColor Yellow
  git stash pop
}

Step "Stage file: $FilePath"
git add -- $FilePath
$staged = git diff --cached --name-only
if (-not $staged) {
  Write-Host "Nothing staged. Save changes and retry." -ForegroundColor Yellow
  exit 0
}

Step "Commit"
git commit -m $Message

Step "Push"
try {
  git push origin main
} catch {
  git push -u origin main
}

Step "Last commit"
git --no-pager log -1 --pretty="format:%H %s"
Write-Host "Done. Vercel will build automatically." -ForegroundColor Green
