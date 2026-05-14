# Scripts de deploy manual

Scripts para cuando necesitas deployar sin esperar GitHub Actions.

## deploy-backend.ps1

Deploya el backend a ECS. **Lee todas las env vars desde AWS en vivo** — nunca
reutiliza la task definition cacheada. Esto evita el bug donde `TRACKER_META_TABLE`
u otras variables se pierden entre deploys manuales.

```powershell
# Deploy prod con la imagen del commit HEAD actual
.\scripts\deploy-backend.ps1

# Deploy a qa
.\scripts\deploy-backend.ps1 -Stage qa

# Deploy con un tag específico (commit SHA o tag de ECR)
.\scripts\deploy-backend.ps1 -ImageTag abc123def456
```

**Requisitos:** AWS CLI configurado, permisos ECS + ECR + DynamoDB.

## deploy-frontend.ps1

Build y deploy del frontend a S3 + invalidación CloudFront.
Lee la URL del backend desde los outputs de Terraform para no hardcodear dominios.

```powershell
.\scripts\deploy-frontend.ps1
.\scripts\deploy-frontend.ps1 -Stage qa
```

**Requisitos:** Node.js, AWS CLI, `terraform init` corrido en `./infra`.

---

## Flujo recomendado post-cambios

```powershell
# 1. Backend (si hay cambios en backend/ o infra/)
.\scripts\deploy-backend.ps1

# 2. Frontend (si hay cambios en frontend/)
.\scripts\deploy-frontend.ps1
```

El script de backend verifica que la imagen exista en ECR antes de deployar.
Si necesitas hacer push de una imagen nueva primero:

```powershell
# Login a ECR
$ACCOUNT = aws sts get-caller-identity --query Account --output text
aws ecr get-login-password --region sa-east-1 | docker login --username AWS --password-stdin "$ACCOUNT.dkr.ecr.sa-east-1.amazonaws.com"

# Build y push
$SHA = git rev-parse HEAD
docker build -t "$ACCOUNT.dkr.ecr.sa-east-1.amazonaws.com/armadillo-tracker-backend:$SHA" ./backend
docker push "$ACCOUNT.dkr.ecr.sa-east-1.amazonaws.com/armadillo-tracker-backend:$SHA"

# Deploy
.\scripts\deploy-backend.ps1 -ImageTag $SHA
```
