# setup-local.ps1
# Corre una vez despues de git clone en cualquier laptop
# Requiere: AWS CLI configurado con credenciales de la cuenta
#
# Por defecto el frontend apunta al backend de produccion para pruebas locales.
# Si necesitas correr el backend local, edita frontend\.env.local manualmente:
#   VITE_API_BASE_URL=http://localhost:3000
#   VITE_WS_URL=ws://localhost:3000

$repo   = Split-Path -Parent $MyInvocation.MyCommand.Path
$region = "sa-east-1"
$utf8NoBom = [System.Text.UTF8Encoding]::new($false)

# ── URLs del backend ──────────────────────────────────────────────────────────
$BACKEND_URL    = "https://api.tracker.etarmadillo.com"
$BACKEND_WS_URL = "wss://api.tracker.etarmadillo.com"

Write-Host "Bajando keys desde SSM..." -ForegroundColor Cyan

$MapApiKey = aws ssm get-parameter `
    --name "/armadillo-tracker/dev/VITE_MAP_API_KEY" `
    --with-decryption `
    --query "Parameter.Value" `
    --output text `
    --region $region

$GoogleApiKey = aws ssm get-parameter `
    --name "/armadillo-tracker/dev/GOOGLE_MAPS_API_KEY" `
    --with-decryption `
    --query "Parameter.Value" `
    --output text `
    --region $region

if (-not $MapApiKey -or -not $GoogleApiKey) {
    Write-Host "Error: no se pudieron obtener las keys de SSM." -ForegroundColor Red
    Write-Host "Verifica que el AWS CLI este configurado con la cuenta correcta." -ForegroundColor Red
    exit 1
}

Write-Host "  Keys obtenidas." -ForegroundColor Green

# ── backend\.env ──────────────────────────────────────────────────────────────
$backendEnv = Join-Path $repo "backend\.env"
if (-not (Test-Path $backendEnv)) {
    $content = "AWS_REGION=sa-east-1`nGEOFENCE_COLLECTION=armadillo-tracker-geofence-collection`nROUTE_CALCULATOR=armadillo-route-calculator`nROUTES_TABLE=armadillo-dev-routes`nPLACE_INDEX=armadillo-places`nGOOGLE_MAPS_API_KEY=$GoogleApiKey"
    [System.IO.File]::WriteAllText($backendEnv, $content, $utf8NoBom)
    Write-Host "  backend\.env creado" -ForegroundColor Green
} else {
    Write-Host "  backend\.env ya existe, no se sobreescribe" -ForegroundColor Yellow
}

# ── frontend\.env.local ───────────────────────────────────────────────────────
$frontendEnvLocal = Join-Path $repo "frontend\.env.local"
if (-not (Test-Path $frontendEnvLocal)) {
    $content = "VITE_API_BASE_URL=$BACKEND_URL`nVITE_WS_URL=$BACKEND_WS_URL`nVITE_AWS_REGION=sa-east-1`nVITE_MAP_STYLE=Hybrid`nVITE_MAP_API_KEY=$MapApiKey"
    [System.IO.File]::WriteAllText($frontendEnvLocal, $content, $utf8NoBom)
    Write-Host "  frontend\.env.local creado (apuntando a produccion)" -ForegroundColor Green
} else {
    Write-Host "  frontend\.env.local ya existe, no se sobreescribe" -ForegroundColor Yellow
}

# ── Dependencias ──────────────────────────────────────────────────────────────
Write-Host "Instalando dependencias..." -ForegroundColor Cyan
npm install
npm install --prefix backend
npm install --prefix frontend
Write-Host "  Dependencias instaladas." -ForegroundColor Green

Write-Host ""
Write-Host "Listo. Para correr el frontend:" -ForegroundColor Cyan
Write-Host "  cd frontend && npm run dev" -ForegroundColor White
Write-Host ""
Write-Host "El frontend apunta a: $BACKEND_URL" -ForegroundColor DarkCyan
Write-Host "Para usar backend local edita frontend\.env.local" -ForegroundColor DarkGray
