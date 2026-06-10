# Public hosting for the web dashboard: a private S3 bucket served through
# CloudFront with Origin Access Control. The bucket is never public; only the
# distribution can read it. We stay on the default CloudFront certificate
# (*.cloudfront.net) rather than a custom domain, which would need an ACM
# cert in us-east-1 and DNS validation churn the challenge timeline does not
# allow.

data "aws_caller_identity" "current" {}

resource "aws_s3_bucket" "web" {
  # Account id suffix keeps the global bucket namespace collision-free.
  bucket        = "${var.app_name}-web-${data.aws_caller_identity.current.account_id}"
  force_destroy = true
}

resource "aws_s3_bucket_public_access_block" "web" {
  bucket                  = aws_s3_bucket.web.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_cloudfront_origin_access_control" "web" {
  name                              = "${var.app_name}-web"
  description                       = "OAC for the ${var.app_name} web bucket"
  origin_access_control_origin_type = "s3"
  signing_behavior                  = "always"
  signing_protocol                  = "sigv4"
}

# AWS managed policy: long TTLs, gzip/brotli, no cookies or query strings
# forwarded. Vite emits content-hashed assets so aggressive caching is safe;
# index.html updates are handled by the post-deploy invalidation.
data "aws_cloudfront_cache_policy" "caching_optimized" {
  name = "Managed-CachingOptimized"
}

resource "aws_cloudfront_distribution" "web" {
  enabled             = true
  comment             = "${var.app_name} web dashboard"
  default_root_object = "index.html"
  is_ipv6_enabled     = true
  price_class         = "PriceClass_100" # EU + North America edges only

  origin {
    domain_name              = aws_s3_bucket.web.bucket_regional_domain_name
    origin_id                = "web-s3"
    origin_access_control_id = aws_cloudfront_origin_access_control.web.id
  }

  default_cache_behavior {
    target_origin_id       = "web-s3"
    viewer_protocol_policy = "redirect-to-https"
    allowed_methods        = ["GET", "HEAD", "OPTIONS"]
    cached_methods         = ["GET", "HEAD"]
    cache_policy_id        = data.aws_cloudfront_cache_policy.caching_optimized.id
    compress               = true
  }

  # SPA fallback: S3 returns 403 (no ListBucket) or 404 for client-side
  # routes like /metrics/sleep, so both map to index.html with a 200 and the
  # router takes over.
  custom_error_response {
    error_code            = 403
    response_code         = 200
    response_page_path    = "/index.html"
    error_caching_min_ttl = 0
  }

  custom_error_response {
    error_code            = 404
    response_code         = 200
    response_page_path    = "/index.html"
    error_caching_min_ttl = 0
  }

  restrictions {
    geo_restriction {
      restriction_type = "none"
    }
  }

  aliases = ["app.youth.luminik.io"]

  viewer_certificate {
    acm_certificate_arn      = aws_acm_certificate_validation.web.certificate_arn
    ssl_support_method       = "sni-only"
    minimum_protocol_version = "TLSv1.2_2021"
  }
}

data "aws_iam_policy_document" "web_bucket" {
  statement {
    sid       = "AllowCloudFrontRead"
    actions   = ["s3:GetObject"]
    resources = ["${aws_s3_bucket.web.arn}/*"]

    principals {
      type        = "Service"
      identifiers = ["cloudfront.amazonaws.com"]
    }

    condition {
      test     = "StringEquals"
      variable = "AWS:SourceArn"
      values   = [aws_cloudfront_distribution.web.arn]
    }
  }
}

resource "aws_s3_bucket_policy" "web" {
  bucket = aws_s3_bucket.web.id
  policy = data.aws_iam_policy_document.web_bucket.json

  depends_on = [aws_s3_bucket_public_access_block.web]
}

output "web_url" {
  description = "Public URL of the web dashboard"
  value       = "https://${aws_cloudfront_distribution.web.domain_name}"
}

output "web_bucket" {
  description = "S3 bucket the CI pipeline syncs the web build into (GitHub variable WEB_BUCKET)"
  value       = aws_s3_bucket.web.bucket
}

output "web_distribution_id" {
  description = "CloudFront distribution id for invalidations (GitHub variable CF_DISTRIBUTION_ID)"
  value       = aws_cloudfront_distribution.web.id
}

# Stable hostname for the public dashboard.
resource "aws_acm_certificate" "web" {
  provider          = aws.us_east_1
  domain_name       = "app.youth.luminik.io"
  validation_method = "DNS"

  lifecycle {
    create_before_destroy = true
  }
}

resource "aws_route53_record" "web_cert_validation" {
  for_each = {
    for dvo in aws_acm_certificate.web.domain_validation_options : dvo.domain_name => {
      name   = dvo.resource_record_name
      record = dvo.resource_record_value
      type   = dvo.resource_record_type
    }
  }

  zone_id = data.aws_route53_zone.main.zone_id
  name    = each.value.name
  type    = each.value.type
  records = [each.value.record]
  ttl     = 60
}

resource "aws_acm_certificate_validation" "web" {
  provider                = aws.us_east_1
  certificate_arn         = aws_acm_certificate.web.arn
  validation_record_fqdns = [for r in aws_route53_record.web_cert_validation : r.fqdn]
}

resource "aws_route53_record" "web" {
  zone_id = data.aws_route53_zone.main.zone_id
  name    = "app.youth.luminik.io"
  type    = "A"

  alias {
    name                   = aws_cloudfront_distribution.web.domain_name
    zone_id                = aws_cloudfront_distribution.web.hosted_zone_id
    evaluate_target_health = false
  }
}
