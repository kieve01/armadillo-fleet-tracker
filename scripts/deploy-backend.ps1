#!/usr/bin/env pwsh
<#
.SYNOPSIS
    Deploy manual del backend a ECS.
    Lee las env vars desde AWS en vivo (DynamoDB, SSM, etc.) — nunca desde la task
    definition cacheada. Así no hay riesgo de perder variables entre deploys.

.PARAMETER Stage
    Entorno destino: 'prod' o 'qa'. Default: prod.

.PARAMETER Region
    Región AWS. Default: sa-east-1.

.PARAMETER AppName
    Nombre base de la app. Default: armadillo-tracker.

.PARAMETER ImageTag
    Tag de la imagen ECR. Default: el SHA del commit HEAD de git.

.EXAMPLE
    .\scripts\deploy-backend.ps1
    .\scripts\deploy-backend.ps1 -Stage qa
    .\scripts\deploy-backend.ps1 -ImageTag abc123def456
#>

param(
    [string]$Stage    = 'prod',
    [string]$Region   = 'sa-east-1',
    [string]$AppName  = 'armadillo-tracker',
    [string]$ImageTag = ''
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

# ── Helpers ───────────────────────────────────────────────────────────────────
function Write-Step  { param([string]$msg) Write-Host "`n  $msg" -ForegroundColor Cyan }
function Write-OK    { param([string]$msg) Write-Host "  OK  $msg" -ForegroundColor Green }
function Write-Fail  { param([string]$msg) Write-Host "  ERR $msg" -ForegroundColor Red; exit 1 }

function Invoke-AWS {
    param([string[]]$Cmd)
    $out = & aws @Cmd 2>$null
    if ($LASTEXITCODE -ne 0) {
        $errOut = & aws @Cmd 2>&1
        Write-Fail "aws $($Cmd[0..2] -join ' ') fallo: $errOut"
    }
    return $out
}

# ── Config ────────────────────────────────────────────────────────────────────
$Cluster  = "$AppName-$Stage"
$Service  = "$AppName-$Stage-backend"
$TDFamily = "$AppName-$Stage-backend"

# ── Image tag ─────────────────────────────────────────────────────────────────
if (-not $ImageTag) {
    $ImageTag = (git rev-parse HEAD 2>$null).Trim()
    if (-not $ImageTag) { Write-Fail "No se pudo obtener el SHA de git. Pasa -ImageTag manualmente." }
    Write-Host "  Usando imagen del commit HEAD: $ImageTag" -ForegroundColor DarkGray
}

# ── ECR URL ───────────────────────────────────────────────────────────────────
Write-Step "Resolviendo ECR..."
$EcrUrl = (Invoke-AWS @('ecr','describe-repositories','--repository-names',"$AppName-backend",'--region',$Region,'--query','repositories[0].repositoryUri','--output','text') 2>&1).Trim()
$ImageUri = "${EcrUrl}:${ImageTag}"
Write-OK $ImageUri

# ── Verificar que la imagen existe ────────────────────────────────────────────
Write-Step "Verificando imagen en ECR..."
$tagCheck = aws ecr describe-images --repository-name "$AppName-backend" --image-ids "imageTag=$ImageTag" --region $Region 2>&1
if ($LASTEXITCODE -ne 0) {
    Write-Fail "Imagen '$ImageTag' no existe en ECR. Haz push primero o usa un tag distinto."
}
Write-OK "Imagen encontrada."

# ── Leer env vars desde AWS en vivo ──────────────────────────────────────────
# Esto evita el bug de reutilizar una TD con env vars desactualizadas.
Write-Step "Leyendo recursos AWS para construir env vars..."

# DynamoDB tables — busca por prefijo app+stage para no hardcodear nombres
$allTables = (Invoke-AWS @('dynamodb','list-tables','--region',$Region,'--output','json')) | ConvertFrom-Json
$TableNames = $allTables.TableNames | Where-Object { $_ -like "$AppName-$Stage-*" }

$RoutesTable      = $TableNames | Where-Object { $_ -like '*routes*'       } | Select-Object -First 1
$TrackerMetaTable = $TableNames | Where-Object { $_ -like '*tracker-meta*' } | Select-Object -First 1

if (-not $RoutesTable)      { Write-Fail "No se encontró tabla DynamoDB de rutas para $AppName-$Stage" }
if (-not $TrackerMetaTable) { Write-Fail "No se encontró tabla DynamoDB tracker-meta para $AppName-$Stage" }

Write-OK "ROUTES_TABLE      = $RoutesTable"
Write-OK "TRACKER_META_TABLE = $TrackerMetaTable"

# Env vars de la TD actual que NO vienen de AWS (se leen de la TD vigente)
Write-Step "Leyendo variables de configuración desde la task definition actual..."
$CurrentTD = (Invoke-AWS @('ecs','describe-task-definition','--task-definition',$TDFamily,'--region',$Region,'--query','taskDefinition','--output','json')) | ConvertFrom-Json
$CurrentEnv = $CurrentTD.containerDefinitions[0].environment

function Get-EnvVal {
    param([string]$Name)
    $entry = $CurrentEnv | Where-Object { $_.name -eq $Name }
    if ($entry) { return $entry.value } else { return '' }
}

$Port              = Get-EnvVal 'PORT'
$AwsRegion         = Get-EnvVal 'AWS_REGION'
$GeofenceCollection = Get-EnvVal 'GEOFENCE_COLLECTION'
$RouteCalculator   = Get-EnvVal 'ROUTE_CALCULATOR'
$PlaceIndex        = Get-EnvVal 'PLACE_INDEX'
$GoogleMapsApiKey  = Get-EnvVal 'GOOGLE_MAPS_API_KEY'

if (-not $Port)    { $Port    = '3000' }
if (-not $AwsRegion) { $AwsRegion = $Region }

Write-OK "PORT=$Port  AWS_REGION=$AwsRegion  GEOFENCE=$GeofenceCollection"

# ── Construir nueva task definition ──────────────────────────────────────────
Write-Step "Construyendo task definition..."

# Tomar la TD actual como base y actualizar imagen + env vars
$NewTD = $CurrentTD | ConvertTo-Json -Depth 20 | ConvertFrom-Json

# Limpiar campos que no se pueden pasar al register
$fieldsToRemove = @('taskDefinitionArn','revision','status','requiresAttributes','compatibilities','registeredAt','registeredBy')
foreach ($f in $fieldsToRemove) {
    $NewTD.PSObject.Properties.Remove($f)
}

# Actualizar imagen
$NewTD.containerDefinitions[0].image = $ImageUri

# Reconstruir env vars desde cero con valores en vivo
$NewTD.containerDefinitions[0].environment = @(
    @{ name = 'PORT';                value = $Port              }
    @{ name = 'AWS_REGION';          value = $AwsRegion         }
    @{ name = 'ROUTES_TABLE';        value = $RoutesTable        }
    @{ name = 'TRACKER_META_TABLE';  value = $TrackerMetaTable   }
    @{ name = 'GEOFENCE_COLLECTION'; value = $GeofenceCollection }
    @{ name = 'ROUTE_CALCULATOR';    value = $RouteCalculator    }
    @{ name = 'PLACE_INDEX';         value = $PlaceIndex         }
    @{ name = 'GOOGLE_MAPS_API_KEY'; value = $GoogleMapsApiKey   }
)

$TdJson = $NewTD | ConvertTo-Json -Depth 20
$TdFile = [System.IO.Path]::GetTempFileName() + '.json'
$TdJson | Set-Content -Path $TdFile -Encoding UTF8

# ── Registrar nueva task definition ──────────────────────────────────────────
Write-Step "Registrando task definition..."
$RegResult = (Invoke-AWS @('ecs','register-task-definition','--region',$Region,'--cli-input-json',"file://$TdFile",'--query','taskDefinition.taskDefinitionArn','--output','text')).Trim()
Remove-Item $TdFile -ErrorAction SilentlyContinue
Write-OK $RegResult

# ── Deploy al servicio ────────────────────────────────────────────────────────
Write-Step "Actualizando servicio ECS..."
Invoke-AWS @('ecs','update-service','--cluster',$Cluster,'--service',$Service,'--task-definition',$RegResult,'--force-new-deployment','--region',$Region,'--output','none') | Out-Null
Write-OK "Servicio actualizado. Esperando estabilidad..."

# ── Esperar que el servicio esté estable ──────────────────────────────────────
Write-Step "Esperando que el servicio esté estable (puede tardar 2-4 min)..."
aws ecs wait services-stable --cluster $Cluster --services $Service --region $Region
if ($LASTEXITCODE -ne 0) {
    Write-Fail "El servicio no estabilizó. Revisar logs en CloudWatch: /ecs/$AppName-$Stage-backend"
}

Write-Host "`n  Deploy completado." -ForegroundColor Green
Write-Host "  Imagen: $ImageUri" -ForegroundColor DarkGray
Write-Host "  Task:   $RegResult" -ForegroundColor DarkGray
