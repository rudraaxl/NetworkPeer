variable "project" {
  type = string
}

variable "environment" {
  type = string
}

variable "database_url" {
  type      = string
  sensitive = true
}

variable "redis_url" {
  type      = string
  sensitive = true
}

variable "jwt_access_secret" {
  type      = string
  sensitive = true
}

variable "jwt_refresh_secret" {
  type      = string
  sensitive = true
}

variable "payment_webhook_secret" {
  type      = string
  sensitive = true
}

locals {
  name_prefix = "${var.project}-${var.environment}"
}

resource "aws_secretsmanager_secret" "app" {
  name = "${local.name_prefix}/app"

  tags = {
    Name = "${local.name_prefix}-app-secret"
  }
}

resource "aws_secretsmanager_secret_version" "app" {
  secret_id = aws_secretsmanager_secret.app.id

  secret_string = jsonencode({
    DATABASE_URL           = var.database_url
    REDIS_URL              = var.redis_url
    JWT_SECRET             = var.jwt_access_secret
    JWT_REFRESH_SECRET     = var.jwt_refresh_secret
    PAYMENT_WEBHOOK_SECRET = var.payment_webhook_secret
  })
}

output "secret_arn" {
  value = aws_secretsmanager_secret.app.arn
}
