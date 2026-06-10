terraform {
  required_version = ">= 1.5"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.80"
    }
    random = {
      source  = "hashicorp/random"
      version = "~> 3.6"
    }
  }
  # Demo scope: local state. Production would use an S3 backend with state
  # locking (see docs/architecture.md).
}

provider "aws" {
  region  = var.region
  profile = var.aws_profile

  default_tags {
    tags = {
      Project   = "youth-wearables"
      ManagedBy = "terraform"
    }
  }
}

# Default VPC keeps the demo footprint small. Production gets a dedicated
# VPC with private subnets and NAT (documented in docs/architecture.md).
data "aws_vpc" "default" {
  default = true
}

data "aws_subnets" "default" {
  filter {
    name   = "vpc-id"
    values = [data.aws_vpc.default.id]
  }
}
