# ECS Fargate: stateless API tasks behind the ALB plus queue workers.
# Scaling model: API and workers scale independently (the load profile of
# webhook bursts is absorbed by the queue, workers drain it).

resource "aws_ecr_repository" "backend" {
  name                 = "${var.app_name}-backend"
  image_tag_mutability = "MUTABLE"
  force_delete         = true

  image_scanning_configuration {
    scan_on_push = true
  }
}

resource "aws_ecs_cluster" "main" {
  name = var.app_name

  setting {
    name  = "containerInsights"
    value = "enabled"
  }
}

resource "aws_security_group" "ecs" {
  name_prefix = "${var.app_name}-ecs-"
  vpc_id      = data.aws_vpc.default.id

  ingress {
    from_port       = 8000
    to_port         = 8000
    protocol        = "tcp"
    security_groups = [aws_security_group.alb.id]
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }
}

resource "aws_cloudwatch_log_group" "api" {
  name              = "/ecs/${var.app_name}-api"
  retention_in_days = 14
}

resource "aws_cloudwatch_log_group" "worker" {
  name              = "/ecs/${var.app_name}-worker"
  retention_in_days = 14
}

locals {
  common_environment = [
    { name = "REDIS_URL", value = "redis://${aws_elasticache_cluster.main.cache_nodes[0].address}:6379/0" },
    { name = "AGGREGATOR_ENVIRONMENT", value = var.aggregator_environment },
    { name = "AGGREGATOR_REGION", value = "eu" },
    { name = "CLERK_ISSUER", value = var.clerk_issuer },
    { name = "ENVIRONMENT", value = "staging" },
    { name = "LOG_LEVEL", value = "INFO" },
  ]
  common_secrets = [
    { name = "DATABASE_URL", valueFrom = aws_ssm_parameter.database_url.arn },
    { name = "AGGREGATOR_API_KEY", valueFrom = aws_ssm_parameter.aggregator_api_key.arn },
    { name = "AGGREGATOR_WEBHOOK_SECRET", valueFrom = aws_ssm_parameter.aggregator_webhook_secret.arn },
    { name = "AGGREGATOR_PROD_API_KEY", valueFrom = aws_ssm_parameter.aggregator_prod_api_key.arn },
    { name = "AGGREGATOR_PROD_WEBHOOK_SECRET", valueFrom = aws_ssm_parameter.aggregator_prod_webhook_secret.arn },
    { name = "API_AUTH_TOKEN", valueFrom = aws_ssm_parameter.api_auth_token.arn },
  ]
  image = "${aws_ecr_repository.backend.repository_url}:latest"
}

resource "aws_ecs_task_definition" "api" {
  family                   = "${var.app_name}-api"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = 256
  memory                   = 512
  execution_role_arn       = aws_iam_role.execution.arn
  task_role_arn            = aws_iam_role.task.arn

  container_definitions = jsonencode([{
    name  = "api"
    image = local.image
    # Migrations run before serving. Single-writer migration semantics are
    # acceptable at this scale; production promotes migrations to a
    # dedicated deploy step (see docs/architecture.md).
    command      = ["sh", "-c", "alembic upgrade head && uvicorn app.main:app --host 0.0.0.0 --port 8000"]
    portMappings = [{ containerPort = 8000, protocol = "tcp" }]
    environment  = local.common_environment
    secrets      = local.common_secrets
    logConfiguration = {
      logDriver = "awslogs"
      options = {
        awslogs-group         = aws_cloudwatch_log_group.api.name
        awslogs-region        = var.region
        awslogs-stream-prefix = "api"
      }
    }
  }])
}

resource "aws_ecs_task_definition" "worker" {
  family                   = "${var.app_name}-worker"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = 256
  memory                   = 512
  execution_role_arn       = aws_iam_role.execution.arn
  task_role_arn            = aws_iam_role.task.arn

  container_definitions = jsonencode([{
    name        = "worker"
    image       = local.image
    command     = ["arq", "app.workers.worker.WorkerSettings"]
    environment = local.common_environment
    secrets     = local.common_secrets
    logConfiguration = {
      logDriver = "awslogs"
      options = {
        awslogs-group         = aws_cloudwatch_log_group.worker.name
        awslogs-region        = var.region
        awslogs-stream-prefix = "worker"
      }
    }
  }])
}

resource "aws_ecs_service" "api" {
  name            = "api"
  cluster         = aws_ecs_cluster.main.id
  task_definition = aws_ecs_task_definition.api.arn
  desired_count   = var.api_desired_count
  launch_type     = "FARGATE"

  network_configuration {
    subnets          = data.aws_subnets.default.ids
    security_groups  = [aws_security_group.ecs.id]
    assign_public_ip = true # default VPC has no NAT; production uses private subnets
  }

  load_balancer {
    target_group_arn = aws_lb_target_group.api.arn
    container_name   = "api"
    container_port   = 8000
  }

  depends_on = [aws_lb_listener.https]
}

resource "aws_ecs_service" "worker" {
  name            = "worker"
  cluster         = aws_ecs_cluster.main.id
  task_definition = aws_ecs_task_definition.worker.arn
  desired_count   = var.worker_desired_count
  launch_type     = "FARGATE"

  network_configuration {
    subnets          = data.aws_subnets.default.ids
    security_groups  = [aws_security_group.ecs.id]
    assign_public_ip = true
  }
}
