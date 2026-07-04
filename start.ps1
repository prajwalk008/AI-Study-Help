# Starts both the backend (FastAPI) and frontend (Next.js) dev servers.
# Usage:  ./start.ps1
$ErrorActionPreference = "Stop"
$root = $PSScriptRoot

Write-Host "Starting backend on http://127.0.0.1:8000 ..." -ForegroundColor Cyan
Start-Process powershell -ArgumentList @(
  "-NoExit", "-Command",
  "cd '$root\backend'; & .\.venv\Scripts\python.exe -m uvicorn app.main:app --port 8000"
)

Start-Sleep -Seconds 2

Write-Host "Starting frontend on http://localhost:3000 ..." -ForegroundColor Cyan
Start-Process powershell -ArgumentList @(
  "-NoExit", "-Command",
  "cd '$root\frontend'; & npm.cmd run dev"
)

Write-Host "`nBoth servers launching in separate windows. Open http://localhost:3000" -ForegroundColor Green
