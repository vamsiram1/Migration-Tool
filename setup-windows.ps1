$ErrorActionPreference = 'Stop'
$projectDir = Split-Path -Parent $MyInvocation.MyCommand.Path

if (-not (Get-Command py -ErrorAction SilentlyContinue)) {
    throw 'Python was not found. Install Python 3.11 or newer and enable the py launcher.'
}
if (-not (Get-Command npm -ErrorAction SilentlyContinue)) {
    throw 'Node.js/npm was not found. Install the current Node.js LTS release.'
}

Set-Location $projectDir
py -3 -m venv .venv
& "$projectDir\.venv\Scripts\python.exe" -m pip install --upgrade pip
& "$projectDir\.venv\Scripts\python.exe" -m pip install -r "$projectDir\backend\requirements.txt"
Set-Location "$projectDir\frontend"
npm ci

Write-Host 'Setup complete. Run .\start-windows.ps1' -ForegroundColor Green
