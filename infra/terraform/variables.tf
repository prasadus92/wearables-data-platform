variable "region" {
  description = "AWS region (EU to match the Junction EU data residency)"
  type        = string
  default     = "eu-central-1"
}

variable "aws_profile" {
  description = "AWS CLI profile to use"
  type        = string
  default     = "luminik"
}

variable "app_name" {
  type    = string
  default = "youth-wearables"
}

variable "domain_zone" {
  description = "Route53 hosted zone for the API domain"
  type        = string
  default     = "luminik.io"
}

variable "api_domain" {
  description = "Public hostname for the API (webhooks + app traffic)"
  type        = string
  default     = "api.youth.luminik.io"
}

variable "junction_api_key" {
  description = "Junction team API key (sandbox or production)"
  type        = string
  sensitive   = true
}

variable "junction_environment" {
  description = "Junction environment the key belongs to: sandbox | production"
  type        = string
  default     = "sandbox"
}

variable "api_auth_token" {
  description = "Static token required by the /v1 API (X-API-Key / Bearer)"
  type        = string
  sensitive   = true
}

variable "junction_webhook_secret" {
  description = "Svix signing secret from the Junction webhook endpoint config (set after registering the endpoint)"
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
