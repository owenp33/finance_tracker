<#
.SYNOPSIS
    One-command local development: Postgres (Docker) + Flask API + React dev server.

.DESCRIPTION
    1. Starts Docker Desktop if needed, then the dev database (docker-compose.dev.yml)
    2. Installs backend and frontend dependencies on first run, or after their
       requirements/lockfile change
    3. Runs the API (:5000) and React (:3000) together in this window with labeled output.
       Both accept connections from this machine only.
    4. -Lan opens the React dev server to your local network (e.g. a phone on your Wi-Fi).
       Use it on trusted networks only.
    5. -Ngrok also tunnels the React dev server so the app opens on another device.
       The dev server proxies /api to Flask, so Flask itself never needs to be exposed.

    Ctrl+C stops the API and React, then stops the database container (data is kept).

.EXAMPLE
    .\dev.ps1
.EXAMPLE
    .\dev.ps1 -Lan
.EXAMPLE
    .\dev.ps1 -Ngrok
#>
param(
    [switch]$Lan,
    [switch]$Ngrok
)

$Root         = $PSScriptRoot
$BackendDir   = Join-Path $Root 'backend'
$FrontendDir  = Join-Path $Root 'frontend'
$Python       = Join-Path $BackendDir 'venv\Scripts\python.exe'
$ComposeFile  = Join-Path $Root 'docker-compose.dev.yml'
$Concurrently = 'concurrently@9.1.2'   # run via npx; not a project dependency

# True when $Stamp is missing or older than any of $Sources
function Test-Stale([string[]]$Sources, [string]$Stamp) {
    if (-not (Test-Path $Stamp)) { return $true }
    $stampTime = (Get-Item $Stamp).LastWriteTime
    foreach ($source in $Sources) {
        if ((Get-Item $source).LastWriteTime -gt $stampTime) { return $true }
    }
    return $false
}

# ── 1. Database ───────────────────────────────────────────────────────────────
docker info *> $null
if ($LASTEXITCODE -ne 0) {
    Write-Host '>> Starting Docker Desktop...'
    Start-Process (Join-Path $env:ProgramFiles 'Docker\Docker\Docker Desktop.exe')
    $deadline = (Get-Date).AddMinutes(3)
    do {
        Start-Sleep -Seconds 3
        docker info *> $null
    } until ($LASTEXITCODE -eq 0 -or (Get-Date) -gt $deadline)
    if ($LASTEXITCODE -ne 0) { throw 'Docker did not start. Open Docker Desktop and try again.' }
}

Write-Host '>> Starting database...'
docker compose -f $ComposeFile up -d --wait
if ($LASTEXITCODE -ne 0) { throw 'The database container failed to start.' }

# ── 2. Dependencies ───────────────────────────────────────────────────────────
$ReqFile  = Join-Path $BackendDir 'requirements.dev.txt'    # includes requirements.prod.txt
$ReqFiles = @($ReqFile, (Join-Path $BackendDir 'requirements.prod.txt'))
$ReqStamp = Join-Path $BackendDir 'venv\.requirements-installed'
$PythonVersion = (Get-Content (Join-Path $BackendDir '.python-version') -TotalCount 1).Trim()

if (-not (Test-Path $Python)) {
    Write-Host '>> Creating backend/venv...'
    python -m venv (Join-Path $BackendDir 'venv')
    if ($LASTEXITCODE -ne 0) { throw "Could not create backend/venv. Is Python $PythonVersion on PATH?" }
}
$venvVersion = & $Python -c "import sys; print('%d.%d' % sys.version_info[:2])"
if ($venvVersion -ne $PythonVersion) {
    Write-Warning "backend/venv uses Python $venvVersion, but backend/.python-version expects $PythonVersion. Delete backend/venv to recreate it with the right version."
}
if (Test-Stale $ReqFiles $ReqStamp) {
    Write-Host '>> Installing backend requirements...'
    & $Python -m pip install --disable-pip-version-check -q -r $ReqFile
    if ($LASTEXITCODE -ne 0) { throw 'pip install failed.' }
    New-Item -ItemType File -Force $ReqStamp | Out-Null
}

$LockFile    = Join-Path $FrontendDir 'package-lock.json'
$LockStamp   = Join-Path $FrontendDir 'node_modules\.package-lock.json'   # npm rewrites it on every install
$NodeVersion = (Get-Content (Join-Path $FrontendDir '.nvmrc') -TotalCount 1).Trim()

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    throw "Node.js $NodeVersion is required (frontend/.nvmrc) but node is not on PATH."
}
$hostNodeMajor = (node --version) -replace '^v(\d+)\..*$', '$1'
if ($hostNodeMajor -ne $NodeVersion) {
    Write-Warning "Node $hostNodeMajor is installed, but frontend/.nvmrc expects $NodeVersion."
}
if (Test-Stale $LockFile $LockStamp) {
    Write-Host '>> Installing frontend packages...'
    Push-Location $FrontendDir
    npm ci --no-audit --no-fund
    $npmExit = $LASTEXITCODE
    Pop-Location
    if ($npmExit -ne 0) { throw 'npm ci failed.' }
}

# ── 3. Run ────────────────────────────────────────────────────────────────────
$names    = 'api,web'
$colors   = 'blue,green'
$commands = @('cd backend && venv\Scripts\python.exe app.py', 'cd frontend && npm start')
$envOverrides = @{ PYTHONUNBUFFERED = '1' }   # show Flask output immediately through the pipe

if ($Lan) {
    # Overrides frontend/.env.development: listen on the network, and re-enable the host check
    # (CRA can only run it when bound to all interfaces). Flask stays on localhost.
    $envOverrides.HOST = '0.0.0.0'
    $envOverrides.DANGEROUSLY_DISABLE_HOST_CHECK = 'false'
    Write-Warning 'The app is reachable from other devices on this network. Use -Lan on trusted networks only.'
}

if ($Ngrok) {
    if (Get-Command ngrok -ErrorAction SilentlyContinue) {
        # The React dev server rejects unknown Host headers, and hot reload must
        # reconnect through the tunnel's port
        $envOverrides.DANGEROUSLY_DISABLE_HOST_CHECK = 'true'
        $envOverrides.WDS_SOCKET_PORT = '0'
        $names  += ',ngrok'
        $colors += ',magenta'
        $commands += 'ngrok http 3000 --log stdout'
    } else {
        Write-Warning 'ngrok is not installed; continuing without a tunnel.'
    }
}

# Set overrides for this run only; restored afterwards so this terminal stays clean
$savedEnv = @{}
foreach ($key in $envOverrides.Keys) {
    $savedEnv[$key] = [Environment]::GetEnvironmentVariable($key)
    [Environment]::SetEnvironmentVariable($key, $envOverrides[$key])
}

Write-Host ''
Write-Host '  API:      http://localhost:5000'
Write-Host '  Frontend: http://localhost:3000'
if ($Lan) { Write-Host '  Network:  see the "On Your Network" address in the [web] output' }
Write-Host '  Ctrl+C stops everything.'
Write-Host ''

Push-Location $Root
try {
    npx --yes $Concurrently --kill-others --names $names --prefix-colors $colors @commands
} finally {
    Pop-Location
    foreach ($key in $savedEnv.Keys) { [Environment]::SetEnvironmentVariable($key, $savedEnv[$key]) }
    Write-Host '>> Stopping database (data is kept)...'
    docker compose -f $ComposeFile stop
}
