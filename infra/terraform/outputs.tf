output "api_url" {
  value = "https://${var.api_domain}"
}

output "webhook_url" {
  description = "Register this in Junction: Dashboard -> Webhooks -> Add Endpoint"
  value       = "https://${var.api_domain}/webhooks/junction"
}

output "ecr_repository" {
  value = aws_ecr_repository.backend.repository_url
}

output "alb_dns" {
  value = aws_lb.main.dns_name
}

output "rds_endpoint" {
  value = aws_db_instance.main.address
}
