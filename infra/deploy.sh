#!/usr/bin/env bash
# Build the backend image, push to ECR, and roll the ECS services.
# Usage: ./infra/deploy.sh            (image build + push + service refresh)
#        APPLY=1 ./infra/deploy.sh    (terraform apply first, then the above)
set -euo pipefail

cd "$(dirname "$0")/.."
REGION=${REGION:-eu-central-1}
PROFILE=${AWS_PROFILE:-luminik}

# Junction credentials come from the local .env (never committed).
JUNCTION_API_KEY=$(grep '^JUNCTION_API_KEY=' .env | cut -d= -f2)
JUNCTION_WEBHOOK_SECRET=$(grep '^JUNCTION_WEBHOOK_SECRET=' .env | cut -d= -f2 || true)
export TF_VAR_junction_api_key="$JUNCTION_API_KEY"
export TF_VAR_junction_webhook_secret="$JUNCTION_WEBHOOK_SECRET"
export TF_VAR_api_auth_token="$(grep '^API_AUTH_TOKEN=' .env | cut -d= -f2)"

if [[ "${APPLY:-0}" == "1" ]]; then
  terraform -chdir=infra/terraform init -upgrade -input=false
  terraform -chdir=infra/terraform apply -auto-approve -input=false
fi

ECR=$(terraform -chdir=infra/terraform output -raw ecr_repository)

aws ecr get-login-password --region "$REGION" --profile "$PROFILE" \
  | docker login --username AWS --password-stdin "${ECR%%/*}"

docker build --platform linux/amd64 -t "$ECR:latest" backend/
docker push "$ECR:latest"

aws ecs update-service --cluster youth-wearables --service api --force-new-deployment \
  --region "$REGION" --profile "$PROFILE" --no-cli-pager --query 'service.serviceName'
aws ecs update-service --cluster youth-wearables --service worker --force-new-deployment \
  --region "$REGION" --profile "$PROFILE" --no-cli-pager --query 'service.serviceName'

echo "Deployed. API: $(terraform -chdir=infra/terraform output -raw api_url)"
