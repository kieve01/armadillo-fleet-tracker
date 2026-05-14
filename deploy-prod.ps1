# deploy-prod.ps1
# Deploy completo a produccion: frontend (S3/CloudFront o build local) + backend (ECR + ECS)
# Requiere: AWS CLI configurado, Docker corriendo, Node 20+
# Uso: .\deploy-prod.ps1
#      .\deploy-prod.ps1 -SkipFrontend   (solo backend)
#      .\deploy-prod.ps1 -SkipBackend    (solo frontend build)

param(
    [switch]$SkipFrontend,
    [switch]$SkipBackend
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

# ── Configuracion ─────────────────────────────────────────────────────────────
$REGION       = "sa-east-1"
$APP_NAME     = "armadillo-tracker"
$STAGE        = "prod"
$ECS_CLUSTER  = "$APP_NAME-$STAGE"
$ECS_SERVICE  = "$APP_NAME-$STAGE-backend"
$ECR_REPO     = "$APP_NAME-backend"
$REPO_ROOT    = Split-Path -Parent $MyInvocation.MyCommand.Path

# ── Obtener AWS Account ID ────────────────────────────────────────────────────
Write-Host "Verificando credenciales AWS..." -ForegroundColor Cyan
$ACCOUNT_ID = aws sts get-caller-identity --query "Account" --output text --region $REGION
if (-not $ACCOUNT_ID) {
    Write-Host "Error: no se pudo obtener el Account ID. Verifica el AWS CLI." -ForegroundColor Red
    exit 1
}
$ECR_URI = "$ACCOUNT_ID.dkr.ecr.$REGION.amazonaws.com/$ECR_REPO"
Write-Host "  Account: $ACCOUNT_ID" -ForegroundColor Green
Write-Host "  ECR:     $ECR_URI" -ForegroundColor Green

# ── Obtener Google Maps API Key de SSM ───────────────────────────────────────
Write-Host "Obteniendo GOOGLE_MAPS_API_KEY de SSM..." -ForegroundColor Cyan
$GOOGLE_KEY = aws ssm get-parameter `
    --name "/armadillo-tracker/prod/GOOGLE_MAPS_API_KEY" `
    --with-decryption `
    --query "Parameter.Value" `
    --output text `
    --region $REGION 2>$null

if (-not $GOOGLE_KEY) {
    # Fallback: intentar con el parametro de dev si prod no existe aun
    Write-Host "  Parametro prod no encontrado, intentando dev..." -ForegroundColor Yellow
    $GOOGLE_KEY = aws ssm get-parameter `
        --name "/armadillo-tracker/dev/GOOGLE_MAPS_API_KEY" `
        --with-decryption `
        --query "Parameter.Value" `
        --output text `
        --region $REGION 2>$null
}

if (-not $GOOGLE_KEY) {
    Write-Host "  Advertencia: GOOGLE_MAPS_API_KEY no encontrada en SSM. El backend usara AWS Places/Routes." -ForegroundColor Yellow
    $GOOGLE_KEY = ""
}

# ── Frontend build ────────────────────────────────────────────────────────────
if (-not $SkipFrontend) {
    Write-Host ""
    Write-Host "Compilando frontend para produccion..." -ForegroundColor Cyan
    Push-Location "$REPO_ROOT\frontend"

    # .env.production ya tiene las VITE_* correctas para prod
    # Solo verificamos que exista
    if (-not (Test-Path ".env.production")) {
        Write-Host "Error: frontend\.env.production no encontrado." -ForegroundColor Red
        Pop-Location; exit 1
    }

    npm run build
    if ($LASTEXITCODE -ne 0) {
        Write-Host "Error: frontend build fallo." -ForegroundColor Red
        Pop-Location; exit 1
    }
    Write-Host "  Frontend compilado en frontend\dist\" -ForegroundColor Green
    Pop-Location

    Write-Host ""
    Write-Host "NOTA: Sube el contenido de frontend\dist\ a tu hosting (S3, Cloudflare Pages, etc.)" -ForegroundColor Yellow
    Write-Host "      Si usas S3+CloudFront, ejecuta adicionalmente:" -ForegroundColor Yellow
    Write-Host "      aws s3 sync frontend\dist s3://<tu-bucket> --delete --region $REGION" -ForegroundColor White
    Write-Host "      aws cloudfront create-invalidation --distribution-id <ID> --paths '/*'" -ForegroundColor White
}

# ── Backend: build Docker + push ECR + deploy ECS ────────────────────────────
if (-not $SkipBackend) {
    Write-Host ""
    Write-Host "Autenticando Docker con ECR..." -ForegroundColor Cyan
    aws ecr get-login-password --region $REGION | `
        docker login --username AWS --password-stdin "$ACCOUNT_ID.dkr.ecr.$REGION.amazonaws.com"
    if ($LASTEXITCODE -ne 0) { Write-Host "Error: docker login fallo." -ForegroundColor Red; exit 1 }

    $IMAGE_TAG = (Get-Date -Format "yyyyMMdd-HHmmss")
    $IMAGE_URI_TAG    = "${ECR_URI}:${IMAGE_TAG}"
    $IMAGE_URI_LATEST = "${ECR_URI}:latest"

    Write-Host ""
    Write-Host "Buildeando imagen Docker (tag: $IMAGE_TAG)..." -ForegroundColor Cyan
    Push-Location "$REPO_ROOT\backend"
    docker build -t $IMAGE_URI_TAG -t $IMAGE_URI_LATEST .
    if ($LASTEXITCODE -ne 0) {
        Write-Host "Error: docker build fallo." -ForegroundColor Red
        Pop-Location; exit 1
    }
    Pop-Location

    Write-Host ""
    Write-Host "Pusheando imagen a ECR..." -ForegroundColor Cyan
    docker push $IMAGE_URI_TAG
    docker push $IMAGE_URI_LATEST
    if ($LASTEXITCODE -ne 0) { Write-Host "Error: docker push fallo." -ForegroundColor Red; exit 1 }
    Write-Host "  Imagen publicada: $IMAGE_URI_TAG" -ForegroundColor Green

    # Actualizar la task definition con la nueva imagen y la API key
    Write-Host ""
    Write-Host "Actualizando task definition de ECS..." -ForegroundColor Cyan

    $TASK_FAMILY = "$APP_NAME-$STAGE-backend"

    # Obtener la task definition actual
    $CURRENT_TASK = aws ecs describe-task-definition `
        --task-definition $TASK_FAMILY `
        --region $REGION `
        --query "taskDefinition" | ConvertFrom-Json

    # Actualizar imagen y GOOGLE_MAPS_API_KEY en la definicion
    $CONTAINER = $CURRENT_TASK.containerDefinitions[0]

    # Actualizar imagen
    $CONTAINER.image = $IMAGE_URI_TAG

    # Actualizar o agregar GOOGLE_MAPS_API_KEY en environment
    $ENV_LIST = [System.Collections.Generic.List[object]]($CONTAINER.environment)
    $EXISTING = $ENV_LIST | Where-Object { $_.name -eq "GOOGLE_MAPS_API_KEY" }
    if ($EXISTING) {
        $EXISTING.value = $GOOGLE_KEY
    } else {
        $ENV_LIST.Add([PSCustomObject]@{ name = "GOOGLE_MAPS_API_KEY"; value = $GOOGLE_KEY })
    }
    $CONTAINER.environment = $ENV_LIST

    # Registrar nueva revision
    $NEW_TASK_JSON = @{
        family                  = $CURRENT_TASK.family
        networkMode             = $CURRENT_TASK.networkMode
        requiresCompatibilities = $CURRENT_TASK.requiresCompatibilities
        cpu                     = $CURRENT_TASK.cpu
        memory                  = $CURRENT_TASK.memory
        executionRoleArn        = $CURRENT_TASK.executionRoleArn
        taskRoleArn             = $CURRENT_TASK.taskRoleArn
        containerDefinitions    = @($CONTAINER)
    } | ConvertTo-Json -Depth 10 -Compress

    $NEW_TASK_DEF = aws ecs register-task-definition `
        --cli-input-json $NEW_TASK_JSON `
        --region $REGION | ConvertFrom-Json

    $NEW_TASK_ARN = $NEW_TASK_DEF.taskDefinition.taskDefinitionArn
    Write-Host "  Nueva task definition: $NEW_TASK_ARN" -ForegroundColor Green

    # Actualizar el servicio ECS con la nueva task definition
    Write-Host ""
    Write-Host "Desplegando en ECS ($ECS_CLUSTER / $ECS_SERVICE)..." -ForegroundColor Cyan
    aws ecs update-service `
        --cluster $ECS_CLUSTER `
        --service $ECS_SERVICE `
        --task-definition $NEW_TASK_ARN `
        --force-new-deployment `
        --region $REGION | Out-Null

    Write-Host "  Servicio actualizado. Esperando estabilizacion (puede tardar 1-3 min)..." -ForegroundColor Green

    # Esperar a que el servicio este estable
    aws ecs wait services-stable `
        --cluster $ECS_CLUSTER `
        --services $ECS_SERVICE `
        --region $REGION

    if ($LASTEXITCODE -eq 0) {
        Write-Host "  Servicio estable." -ForegroundColor Green
    } else {
        Write-Host "  Advertencia: el wait expiro. Verifica en la consola ECS que el servicio este corriendo." -ForegroundColor Yellow
    }
}

# ── Resumen ───────────────────────────────────────────────────────────────────
Write-Host ""
Write-Host "Deploy completado." -ForegroundColor Green
Write-Host "  API:       https://api.tracker.etarmadillo.com" -ForegroundColor White
Write-Host "  Frontend:  https://tracker.etarmadillo.com" -ForegroundColor White
Write-Host ""
Write-Host "Para verificar:" -ForegroundColor Cyan
Write-Host "  curl https://api.tracker.etarmadillo.com/health" -ForegroundColor White
