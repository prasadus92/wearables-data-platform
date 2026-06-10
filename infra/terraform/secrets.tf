# Runtime secrets live in SSM Parameter Store (SecureString) and are injected
# into ECS tasks via the `secrets` block, so they never appear in task
# definitions, terraform plan output, or container environment dumps at rest.

resource "aws_ssm_parameter" "database_url" {
  name  = "/${var.app_name}/database-url"
  type  = "SecureString"
  value = "postgresql+asyncpg://wearables:${random_password.db.result}@${aws_db_instance.main.address}:5432/wearables"
}

resource "aws_ssm_parameter" "aggregator_api_key" {
  name  = "/${var.app_name}/aggregator-api-key"
  type  = "SecureString"
  value = var.aggregator_api_key
}

resource "aws_ssm_parameter" "api_auth_token" {
  name  = "/${var.app_name}/api-auth-token"
  type  = "SecureString"
  value = var.api_auth_token
}

resource "aws_ssm_parameter" "aggregator_webhook_secret" {
  name  = "/${var.app_name}/aggregator-webhook-secret"
  type  = "SecureString"
  value = var.aggregator_webhook_secret == "" ? "unset" : var.aggregator_webhook_secret
}

resource "aws_ssm_parameter" "aggregator_prod_api_key" {
  name  = "/${var.app_name}/aggregator-prod-api-key"
  type  = "SecureString"
  value = var.aggregator_prod_api_key == "" ? "unset" : var.aggregator_prod_api_key
}

resource "aws_ssm_parameter" "aggregator_prod_webhook_secret" {
  name  = "/${var.app_name}/aggregator-prod-webhook-secret"
  type  = "SecureString"
  value = var.aggregator_prod_webhook_secret == "" ? "unset" : var.aggregator_prod_webhook_secret
}
