# Title: Laptop dev setup for IntelliPath/IntelliWatt (Windows + Cursor)

# Notes:

# - Uses winget to install Git + Node LTS.

# - Configures Git for clean, linear history (pull --rebase, ff-only on pull).

# - Prefers bundled OpenSSH from Git for Windows; if you already have system OpenSSH that's fine.

# - No '&&' chaining (PowerShell-friendly).

# - Safe to re-run.



# --------

# 0) Verify PowerShell execution context

# --------

$PSVersionTable.PSVersion

whoami



# --------

# 1) Install prerequisites via winget (interactive prompts may appear the first time)

#    If winget isn't found, update Windows App Installer from MS Store, then re-run.

# --------

winget -v

winget install --id Git.Git --source winget

winget install --id OpenJS.NodeJS.LTS --source winget



# Optional: VS Code (if you want it on the laptop too)

# winget install --id Microsoft.VisualStudioCode --source winget



# --------

# 2) Confirm installs

# --------

git --version

ssh -V

node -v

npm -v



# --------

# 3) Git global configuration (safe to re-run)

#    - Linear history: pull.rebase + ff-only

#    - Auto-stash on pull

#    - Prune stale remotes on fetch

#    - Windows↔Unix line endings sane defaults

#    - VS Code as editor (Cursor relies on VS Code core)

# --------

git config --global pull.rebase true

git config --global pull.ff only

git config --global rebase.autoStash true

git config --global fetch.prune true

git config --global core.autocrlf true

git config --global core.editor "code --wait"



# Optional but nice:

git config --global init.defaultBranch main

git config --global push.autoSetupRemote true



# Set your identity (edit email if needed)

git config --global user.name "Brian Littlefield"

git config --global user.email "brian.littlefield@intellipath-solutions.com"



# Show resulting config keys

git config --global --list



# --------

# 4) SSH key (only if you need GitHub/remote SSH from this laptop)

#    - Skips if a key already exists.

# --------

$sshPath = Join-Path $env:USERPROFILE ".ssh"

$newKey = Join-Path $sshPath "id_ed25519"

if (!(Test-Path $sshPath)) { New-Item -ItemType Directory -Force -Path $sshPath | Out-Null }

if (!(Test-Path $newKey)) {

  ssh-keygen -t ed25519 -C "brian.littlefield@intellipath-solutions.com" -f $newKey -N ""

}

# Start agent and add key (Windows OpenSSH)

Get-Service ssh-agent -ErrorAction SilentlyContinue | ForEach-Object {

  if ($_.Status -ne "Running") { Start-Service ssh-agent }

}

ssh-add $newKey

Write-Host "Public key (add to GitHub > Settings > SSH and GPG keys):"

type ($newKey + ".pub")



# --------

# 5) Node package manager prep

#    - Enable Corepack so pnpm/yarn can be activated by project if needed.

# --------

corepack enable

npm config set fund false

npm config set audit false



# --------

# 6) Project sanity (run these from the project root on the laptop)

#    - These won't modify files; they just verify env + build.

# --------

# cd path\to\your\project



# Show which env files exist locally (use -Force to see dotfiles)

Get-ChildItem -Force -Name .env*



# Quick env presence check (outputs booleans)

$env:NODE_ENV="development"

node -e "console.log('MAPS?',!!process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY)"

node -e "console.log('WATTBUY?',!!process.env.WATTBUY_API_KEY)"

node -e "console.log('ADMIN?',!!process.env.ADMIN_TOKEN)"

node -e "console.log('DB?',!!process.env.DATABASE_URL)"



# Install, lint, build (use dev server only if you want to run locally)

npm ci

npm run lint

npm run build

# npm run dev   # uncomment if you want a local server



# --------

# 7) Optional: SMT convenience (only if you'll SFTP from the laptop)

#    - Create ~/.ssh/config host alias for SMT so you can `sftp smt`

# --------

$sshConfig = Join-Path $sshPath "config"

$smtAlias = @"

Host smt

  HostName ftp.smartmetertexas.biz

  User intellipathsolutionsftp

  Port 22

  IdentityFile $env:USERPROFILE\.ssh\intelliwatt_smt_rsa4096

  StrictHostKeyChecking accept-new

"@

if (Test-Path $sshConfig) {

  if (-not (Select-String -Path $sshConfig -Pattern '^Host smt' -Quiet)) { Add-Content -Path $sshConfig -Value $smtAlias }

} else {

  Set-Content -Path $sshConfig -Value $smtAlias -Encoding UTF8

}

# Test (will just connect and exit)

# sftp smt

