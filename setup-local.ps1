#!/usr/bin/env pwsh
# setup-local.ps1
# Corre una vez en cada maquina nueva: .\setup-local.ps1
# No se commitea informacion sensible — las keys van en GitHub Secrets

param(
    [string]$MapApiKey    = "",
    [string]$GoogleApiKey = ""
)

$repo = Split-Path -Parent $MyInvocation.MyCommand.Path

# ─── Backend .env ─────────────────────────────────────────────────────────────
$backendEnv = Join-Path $repo "backend\.env"
if (-not (Test-Path $backendEnv)) {
    @"
AWS_REGION=sa-east-1
GEOFENCE_COLLECTION=armadillo-tracker-geofence-collection
ROUTE_CALCULATOR=armadillo-route-calculator
ROUTES_TABLE=armadillo-dev-routes
PLACE_INDEX=armadillo-places
GOOGLE_MAPS_API_KEY=$GoogleApiKey
"@ | Set-Content $backendEnv
    Write-Host "✓ backend\.env creado" -ForegroundColor Green
} else {
    Write-Host "~ backend\.env ya existe, no se sobreescribe" -ForegroundColor Yellow
}

# ─── Frontend .env.local ──────────────────────────────────────────────────────
$frontendEnvLocal = Join-Path $repo "frontend\.env.local"
if (-not (Test-Path $frontendEnvLocal)) {
    @"
VITE_API_BASE_URL=http://localhost:3000
VITE_WS_URL=ws://localhost:3000
VITE_AWS_REGION=sa-east-1
VITE_MAP_STYLE=Hybrid
VITE_MAP_API_KEY=$MapApiKey
"@ | Set-Content $frontendEnvLocal
    Write-Host "✓ frontend\.env.local creado" -ForegroundColor Green
} else {
    Write-Host "~ frontend\.env.local ya existe, no se sobreescribe" -ForegroundColor Yellow
}

Write-Host ""
Write-Host "Listo. Ahora corre:" -ForegroundColor Cyan
Write-Host "  Terminal 1: cd backend  && npm run dev" -ForegroundColor White
Write-Host "  Terminal 2: cd frontend && npm run dev" -ForegroundColor White
