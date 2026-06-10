variable "region" {
  description = "AWS region (EU to match the Aggregator EU data residency)"
  type        = string
  default     = "eu-central-1"
}

variable "aws_profile" {
  description = "AWS CLI profile to use"
  type        = string
  default     = "default"
}

variable "app_name" {
  type    = string
  default = "wearables-data-platform"
}

variable "domain_zone" {
  description = "Route53 hosted zone for the API domain"
  type        = string
  default     = "example.com"
}

variable "api_domain" {
  description = "Public hostname for the API (webhooks + app traffic)"
  type        = string
  default     = "api.examplehealth.example.com"
}

variable "aggregator_api_key" {
  description = "Aggregator team API key (sandbox or production)"
  type        = string
  sensitive   = true
}

variable "aggregator_environment" {
  description = "Aggregator environment the key belongs to: sandbox | production"
  type        = string
  default     = "sandbox"
}

variable "aggregator_webhook_secret" {
  description = "Svix signing secret from the Aggregator webhook endpoint config (set after registering the endpoint)"
  type        = string
  sensitive   = true
  default     = ""
}

variable "api_desired_count" {
  description = "Number of API tasks behind the ALB"
  type        = number
  default     = 2
}

variable "worker_desired_count" {
  description = "Number of queue worker tasks"
  type        = number
  default     = 1
}
