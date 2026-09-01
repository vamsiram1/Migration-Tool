$ErrorActionPreference = 'Stop'
$projectDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$python = "$projectDir\.venv\Scripts\python.exe"

if (-not (Test-Path $python)) { throw 'Run .\setup-windows.ps1 first.' }
if (-not (Test-Path "$projectDir\frontend\node_modules")) { throw 'Run .\setup-windows.ps1 first.' }

# Ensure ports 8000 and 5173 are clear of stale processes
Get-NetTCPConnection -LocalPort 8000, 5173 -ErrorAction SilentlyContinue | ForEach-Object {
    if ($_.OwningProcess -and $_.OwningProcess -ne 0) {
        Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue
    }
}

Write-Host 'API: http://127.0.0.1:8000' -ForegroundColor Cyan
$api = Start-Process -FilePath $python -ArgumentList '-m', 'uvicorn', 'app.main:app', '--reload', '--reload-dir', "$projectDir\backend", '--host', '127.0.0.1', '--port', '8000' -WorkingDirectory "$projectDir\backend" -PassThru
Write-Host 'Web app: http://127.0.0.1:5173' -ForegroundColor Cyan
$web = Start-Process -FilePath 'npm.cmd' -ArgumentList 'run', 'dev', '--', '--host', '127.0.0.1' -WorkingDirectory "$projectDir\frontend" -PassThru

Write-Host 'Press Ctrl+C to stop both services.' -ForegroundColor Yellow
try {
    while (-not $api.HasExited -and -not $web.HasExited) { Start-Sleep -Seconds 1 }
} finally {
    if (-not $api.HasExited) { Stop-Process -Id $api.Id }
    if (-not $web.HasExited) { Stop-Process -Id $web.Id }
}
