variable "aws_region" {
  description = "AWS region for all resources"
  type        = string
  default     = "ap-south-1"
}

variable "environment" {
  description = "Deployment environment (staging, production)"
  type        = string
  default     = "staging"
}

variable "project" {
  description = "Project name prefix"
  type        = string
  default     = "networkpeer"
}

variable "vpc_cidr" {
  description = "VPC CIDR block"
  type        = string
  default     = "10.0.0.0/16"
}

variable "availability_zones" {
  description = "Availability zones to use"
  type        = list(string)
  default     = ["ap-south-1a", "ap-south-1b"]
}

variable "database_name" {
  description = "PostgreSQL database name"
  type        = string
  default     = "networkpeer"
}

variable "database_master_username" {
  description = "PostgreSQL master username"
  type        = string
  default     = "networkpeer_migration"
  sensitive   = true
}

variable "database_master_password" {
  description = "PostgreSQL master password (override with a secret manager value)"
  type        = string
  default     = null
  sensitive   = true
}

variable "redis_port" {
  description = "Redis port"
  type        = number
  default     = 6379
}

variable "app_port" {
  description = "API container port"
  type        = number
  default     = 3000
}

variable "api_image" {
  description = "Docker image for the API service"
  type        = string
  default     = "networkpeer-api:latest"
}

variable "worker_image" {
  description = "Docker image for the background worker service"
  type        = string
  default     = "networkpeer-api:latest"
}

variable "api_cpu" {
  description = "CPU units for the API task"
  type        = number
  default     = 512
}

variable "api_memory" {
  description = "Memory (MiB) for the API task"
  type        = number
  default     = 1024
}

variable "worker_cpu" {
  description = "CPU units for the worker task"
  type        = number
  default     = 512
}

variable "worker_memory" {
  description = "Memory (MiB) for the worker task"
  type        = number
  default     = 1024
}

variable "api_desired_count" {
  description = "Desired API task count"
  type        = number
  default     = 2
}

variable "worker_desired_count" {
  description = "Desired worker task count"
  type        = number
  default     = 1
}

variable "cors_origins" {
  description = "Comma-separated HTTPS origins allowed by the API"
  type        = string
  default     = "https://networkpeer.example.com"
}

variable "trust_proxy_cidrs" {
  description = "Comma-separated CIDRs to trust for forwarded headers (ALB ranges)"
  type        = string
  default     = ""
}

variable "s3_bucket_name" {
  description = "S3 evidence bucket name"
  type        = string
  default     = "networkpeer-media-staging"
}

variable "sentry_dsn" {
  description = "Sentry DSN for observability"
  type        = string
  default     = ""
}

variable "payment_gateway" {
  description = "Payment gateway provider (stub or stripe)"
  type        = string
  default     = "stub"
}

variable "cloudflare_api_token" {
  description = "Cloudflare API token with DNS edit + zone edit permissions"
  type        = string
  sensitive   = true
  default     = ""
}

variable "cloudflare_zone_id" {
  description = "Cloudflare zone ID for the API domain"
  type        = string
  default     = ""
}

variable "api_domain" {
  description = "Fully qualified API domain name (e.g. api.example.com)"
  type        = string
  default     = "api.networkpeer.example.com"
}

variable "web_domain" {
  description = "Fully qualified web domain name (e.g. app.example.com)"
  type        = string
  default     = "app.networkpeer.example.com"
}
