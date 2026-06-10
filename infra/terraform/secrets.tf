# Runtime secrets live in SSM Parameter Store (SecureString) and are injected
# into ECS tasks via the `secrets` block, so they never appear in task
# definitions, terraform plan output, or container environment dumps at rest.

resource "aws_ssm_parameter" "database_url" {
  name  = "/${var.app_name}/database-url"
  type  = "SecureString"
  value = "postgresql+asyncpg://youth:${random_password.db.result}@${aws_db_instance.main.address}:5432/wearables"
}

resource "aws_ssm_parameter" "junction_api_key" {
  name  = "/${var.app_name}/junction-api-key"
  type  = "SecureString"
  value = var.junction_api_key
}

resource "aws_ssm_parameter" "api_auth_token" {
  name  = "/${var.app_name}/api-auth-token"
  type  = "SecureString"
  value = var.api_auth_token
}

resource "aws_ssm_parameter" "junction_webhook_secret" {
  name  = "/${var.app_name}/junction-webhook-secret"
  type  = "SecureString"
  value = var.junction_webhook_secret == "" ? "unset" : var.junction_webhook_secret
}
