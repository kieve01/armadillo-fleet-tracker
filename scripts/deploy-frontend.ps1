#!/usr/bin/env pwsh
<#
.SYNOPSIS
    Deploy manual del frontend a S3 + invalidación CloudFront.

.PARAMETER Stage
    Entorno destino: 'prod' o 'qa'. Default: prod.

.PARAMETER Region
    Región AWS. Default: sa-east-1.

.PARAMETER AppName
    Nombre base de la app. Default: armadillo-tracker.

.EXAMPLE
    .\scripts\deploy-frontend.ps1
    .\scripts\deploy-frontend.ps1 -Stage qa
#>

param(
    [string]$Stage   = 'prod',
    [string]$Region  = 'sa-east-1',
    [string]$AppName = 'armadillo-tracker'
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Write-Step { param([string]$msg) Write-Host "`n  $msg" -ForegroundColor Cyan }
function Write-OK   { param([string]$msg) Write-Host "  OK  $msg" -ForegroundColor Green }
function Write-Fail { param([string]$msg) Write-Host "  ERR $msg" -ForegroundColor Red; exit 1 }

function Invoke-AWS {
    param([string[]]$Args)
    $out = aws @Args 2>&1
    if ($LASTEXITCODE -ne 0) { Write-Fail "aws $($Args[0..2] -join ' ') failed: $out" }
    return $out
}

# ── Leer infra desde Terraform outputs ───────────────────────────────────────
# Requiere que `terraform init` haya corrido antes en ./infra
Write-Step "Leyendo outputs de Terraform..."

Push-Location (Join-Path $PSScriptRoot '../infra')
$TfOutputsRaw = terraform output -json 2>&1
if ($LASTEXITCODE -ne 0) { Write-Fail "terraform output falló. Asegúrate de haber corrido 'terraform init' en ./infra" }
$TfOutputs = $TfOutputsRaw | ConvertFrom-Json
Pop-Location

$AlbDns         = $TfOutputs.alb_dns_name.value
$AppDomain      = $TfOutputs.app_domain.value

# ── Resolver S3 bucket y CloudFront ID ───────────────────────────────────────
Write-Step "Resolviendo S3 bucket y CloudFront..."

# Bucket: buscar por tag o nombre convencional
$AllBuckets = (Invoke-AWS @('s3api','list-buckets','--query','Buckets[].Name','--output','json')) | ConvertFrom-Json
$FrontendBucket = $AllBuckets | Where-Object { $_ -like "$AppName-$Stage-frontend*" -or $_ -like "$AppName-frontend-$Stage*" } | Select-Object -First 1

if (-not $FrontendBucket) {
    # Fallback: buscar en Terraform state
    Push-Location (Join-Path $PSScriptRoot '../infra')
    $BucketRaw = terraform state show aws_s3_bucket.frontend 2>$null | Select-String 'bucket\s+=' | Select-Object -First 1
    if ($BucketRaw) {
        $FrontendBucket = ($BucketRaw -split '=')[1].Trim().Trim('"')
    }
    Pop-Location
}

if (-not $FrontendBucket) { Write-Fail "No se encontró el bucket S3 del frontend. Verifica el nombre en AWS." }
Write-OK "Bucket: $FrontendBucket"

# CloudFront: buscar por origin que apunte al bucket
$CFList = (Invoke-AWS @('cloudfront','list-distributions','--query','DistributionList.Items[].{id:Id,origin:Origins.Items[0].DomainName}','--output','json')) | ConvertFrom-Json
$CFDist = $CFList | Where-Object { $_.origin -like "*$FrontendBucket*" } | Select-Object -First 1

if (-not $CFDist) { Write-Fail "No se encontró distribución CloudFront para el bucket $FrontendBucket." }
$CFId = $CFDist.id
Write-OK "CloudFront: $CFId"

# ── Leer VITE env vars desde el backend en vivo ───────────────────────────────
Write-Step "Leyendo VITE_API_BASE_URL y VITE_WS_URL..."

# Usar el dominio de la app si está disponible, sino el ALB DNS
$ApiDomain = if ($AppDomain) { $AppDomain.TrimStart('https://') } else { $AlbDns }
$ViteApiBaseUrl = "https://$ApiDomain"
$ViteWsUrl      = "wss://$ApiDomain/ws"

Write-OK "VITE_API_BASE_URL = $ViteApiBaseUrl"
Write-OK "VITE_WS_URL       = $ViteWsUrl"

# ── Build ─────────────────────────────────────────────────────────────────────
Write-Step "Construyendo frontend..."

$FrontendDir = Join-Path $PSScriptRoot '../frontend'
Push-Location $FrontendDir

$env:VITE_API_BASE_URL = $ViteApiBaseUrl
$env:VITE_WS_URL       = $ViteWsUrl

npm ci
if ($LASTEXITCODE -ne 0) { Pop-Location; Write-Fail "npm ci falló." }

npm run build
if ($LASTEXITCODE -ne 0) { Pop-Location; Write-Fail "npm run build falló." }

Pop-Location
Write-OK "Build completado."

# ── Sync a S3 ─────────────────────────────────────────────────────────────────
Write-Step "Sincronizando a S3..."

$DistDir = Join-Path $FrontendDir 'dist'

# Assets con hash → cache largo
Invoke-AWS @('s3','sync',"$DistDir/",'s3://$FrontendBucket/'`
    ,'--delete'`
    ,'--exclude','index.html'`
    ,'--cache-control','public,max-age=31536000,immutable'`
    ,'--region',$Region) | Out-Null

# index.html → sin cache
Invoke-AWS @('s3','cp',"$DistDir/index.html",'s3://$FrontendBucket/index.html'`
    ,'--cache-control','no-cache,no-store,must-revalidate'`
    ,'--region',$Region) | Out-Null

Write-OK "Archivos subidos."

# ── Invalidar CloudFront ──────────────────────────────────────────────────────
Write-Step "Invalidando CloudFront..."
Invoke-AWS @('cloudfront','create-invalidation','--distribution-id',$CFId,'--paths','/*','--output','none') | Out-Null
Write-OK "Invalidación creada."

Write-Host "`n  Deploy frontend completado." -ForegroundColor Green
Write-Host "  URL: $ViteApiBaseUrl" -ForegroundColor DarkGray
