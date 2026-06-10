# CI/CD trust: GitHub Actions assumes an IAM role via OIDC, so the repo holds
# no long-lived AWS keys. The trust policy is pinned to pushes on main of this
# exact repository; pull requests, forks, and other branches cannot assume it.

locals {
  github_repo = "prasadus92/youth-wearables"
}

resource "aws_iam_openid_connect_provider" "github" {
  url            = "https://token.actions.githubusercontent.com"
  client_id_list = ["sts.amazonaws.com"]

  # AWS has validated GitHub's OIDC certificates against trusted root CAs
  # since mid 2023, so these thumbprints are a legacy fallback pin. Both
  # published GitHub intermediates are listed.
  thumbprint_list = [
    "6938fd4d98bab03faadb97b34396831e3780aea1",
    "1c58a3a8518e8759bf075b76b750d4f2df264fcd",
  ]
}

data "aws_iam_policy_document" "github_assume" {
  statement {
    actions = ["sts:AssumeRoleWithWebIdentity"]

    principals {
      type        = "Federated"
      identifiers = [aws_iam_openid_connect_provider.github.arn]
    }

    condition {
      test     = "StringEquals"
      variable = "token.actions.githubusercontent.com:aud"
      values   = ["sts.amazonaws.com"]
    }

    condition {
      test     = "StringEquals"
      variable = "token.actions.githubusercontent.com:sub"
      values   = ["repo:${local.github_repo}:ref:refs/heads/main"]
    }
  }
}

resource "aws_iam_role" "github_deploy" {
  name               = "${var.app_name}-github-deploy"
  description        = "Assumed by GitHub Actions (push to main) to deploy backend and web"
  assume_role_policy = data.aws_iam_policy_document.github_assume.json
}

data "aws_iam_policy_document" "github_deploy" {
  # GetAuthorizationToken does not support resource-level scoping.
  statement {
    sid       = "EcrAuth"
    actions   = ["ecr:GetAuthorizationToken"]
    resources = ["*"]
  }

  statement {
    sid = "EcrPush"
    actions = [
      "ecr:BatchCheckLayerAvailability",
      "ecr:BatchGetImage",
      "ecr:GetDownloadUrlForLayer",
      "ecr:InitiateLayerUpload",
      "ecr:UploadLayerPart",
      "ecr:CompleteLayerUpload",
      "ecr:PutImage",
      "ecr:DescribeRepositories",
      "ecr:DescribeImages",
    ]
    resources = [aws_ecr_repository.backend.arn]
  }

  # Roll the services and wait for them to stabilize (the non-terraform half
  # of infra/deploy.sh).
  statement {
    sid = "EcsDeploy"
    actions = [
      "ecs:UpdateService",
      "ecs:DescribeServices",
    ]
    resources = [
      aws_ecs_service.api.id,
      aws_ecs_service.worker.id,
    ]
  }

  # Read-only access to the runtime secret parameters, matching the set the
  # ECS execution role reads. Deploy steps may need to verify they exist.
  statement {
    sid = "SsmRead"
    actions = [
      "ssm:GetParameter",
      "ssm:GetParameters",
    ]
    resources = [
      aws_ssm_parameter.database_url.arn,
      aws_ssm_parameter.junction_api_key.arn,
      aws_ssm_parameter.junction_webhook_secret.arn,
      aws_ssm_parameter.junction_prod_api_key.arn,
      aws_ssm_parameter.junction_prod_webhook_secret.arn,
      aws_ssm_parameter.api_auth_token.arn,
    ]
  }

  statement {
    sid       = "WebBucketList"
    actions   = ["s3:ListBucket"]
    resources = [aws_s3_bucket.web.arn]
  }

  statement {
    sid = "WebBucketSync"
    actions = [
      "s3:GetObject",
      "s3:PutObject",
      "s3:DeleteObject",
    ]
    resources = ["${aws_s3_bucket.web.arn}/*"]
  }

  statement {
    sid = "CloudFrontInvalidate"
    actions = [
      "cloudfront:CreateInvalidation",
      "cloudfront:GetInvalidation",
    ]
    resources = [aws_cloudfront_distribution.web.arn]
  }
}

resource "aws_iam_role_policy" "github_deploy" {
  name   = "deploy"
  role   = aws_iam_role.github_deploy.id
  policy = data.aws_iam_policy_document.github_deploy.json
}

output "github_actions_role_arn" {
  description = "IAM role for GitHub Actions deploys (GitHub variable AWS_ROLE_ARN)"
  value       = aws_iam_role.github_deploy.arn
}
