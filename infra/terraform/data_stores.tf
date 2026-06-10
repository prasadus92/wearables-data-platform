# Postgres (RDS) and Redis (ElastiCache). Demo sizing; the scaling path is
# documented in docs/architecture.md (read replicas, then Timescale/partitioning).

resource "random_password" "db" {
  length  = 32
  special = false
}

resource "aws_db_subnet_group" "main" {
  name       = "${var.app_name}-db"
  subnet_ids = data.aws_subnets.default.ids
}

resource "aws_security_group" "db" {
  name_prefix = "${var.app_name}-db-"
  vpc_id      = data.aws_vpc.default.id

  ingress {
    from_port       = 5432
    to_port         = 5432
    protocol        = "tcp"
    security_groups = [aws_security_group.ecs.id]
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }
}

resource "aws_db_instance" "main" {
  identifier     = var.app_name
  engine         = "postgres"
  engine_version = "16"
  instance_class = "db.t4g.micro"

  db_name  = "wearables"
  username = "wearables"
  password = random_password.db.result

  allocated_storage     = 20
  max_allocated_storage = 100
  storage_type          = "gp3"

  db_subnet_group_name   = aws_db_subnet_group.main.name
  vpc_security_group_ids = [aws_security_group.db.id]
  publicly_accessible    = false

  backup_retention_period = 1
  skip_final_snapshot     = true # demo lifecycle; production keeps final snapshots
  apply_immediately       = true
}

resource "aws_elasticache_subnet_group" "main" {
  name       = "${var.app_name}-redis"
  subnet_ids = data.aws_subnets.default.ids
}

resource "aws_security_group" "redis" {
  name_prefix = "${var.app_name}-redis-"
  vpc_id      = data.aws_vpc.default.id

  ingress {
    from_port       = 6379
    to_port         = 6379
    protocol        = "tcp"
    security_groups = [aws_security_group.ecs.id]
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }
}

resource "aws_elasticache_cluster" "main" {
  cluster_id         = var.app_name
  engine             = "redis"
  engine_version     = "7.1"
  node_type          = "cache.t3.micro"
  num_cache_nodes    = 1
  port               = 6379
  subnet_group_name  = aws_elasticache_subnet_group.main.name
  security_group_ids = [aws_security_group.redis.id]
}
