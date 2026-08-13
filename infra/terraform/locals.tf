data "aws_caller_identity" "current" {}

locals {
  name_prefix = "${var.project}-${var.environment}"
  common_tags = {
    Project     = var.project
    Environment = var.environment
    ManagedBy   = "terraform"
  }

  database_url = "postgresql://${var.database_master_username}:${urlencode(random_password.database_master.result)}@${module.rds.endpoint}/${var.database_name}?sslmode=require"
  redis_url    = "rediss://:${urlencode(random_password.redis_auth.result)}@${module.elasticache.endpoint}:${var.redis_port}/0"

  app_environment = [
    { name = "NODE_ENV", value = "production" },
    { name = "PORT", value = tostring(var.app_port) },
    { name = "API_PREFIX", value = "/api/v1" },
    { name = "DATABASE_URL", value = local.database_url },
    { name = "DATABASE_ADMIN_URL", value = local.database_url },
    { name = "DATABASE_MEDIA_VERIFIER_URL", value = local.database_url },
    { name = "DATABASE_FINANCIAL_URL", value = local.database_url },
    { name = "REDIS_URL", value = local.redis_url },
    { name = "JWT_SECRET", value = random_password.jwt_access_secret.result },
    { name = "JWT_REFRESH_SECRET", value = random_password.jwt_refresh_secret.result },
    { name = "JWT_ACCESS_TTL", value = "15m" },
    { name = "JWT_REFRESH_TTL", value = "7d" },
    { name = "JWT_ISSUER", value = "networkpeer-api" },
    { name = "JWT_AUDIENCE", value = "networkpeer-mobile" },
    { name = "OTP_ECHO_IN_RESPONSE", value = "false" },
    { name = "SMS_PROVIDER", value = "twilio" },
    { name = "AWS_REGION", value = var.aws_region },
    { name = "AWS_S3_BUCKET", value = module.s3.bucket_name },
    { name = "AWS_S3_PRESIGNED_URL_EXPIRY_SECONDS", value = "600" },
    { name = "PAYMENT_GATEWAY", value = var.payment_gateway },
    { name = "PAYMENT_WEBHOOK_SECRET", value = random_password.payment_webhook_secret.result },
    { name = "CORS_ORIGINS", value = var.cors_origins },
    { name = "TRUST_PROXY_CIDRS", value = var.trust_proxy_cidrs },
    { name = "REALTIME_ENABLED", value = "true" },
    { name = "BACKGROUND_QUEUES_ENABLED", value = "true" },
    { name = "LOG_PRETTY", value = "false" },
    { name = "LOG_LEVEL", value = "info" },
  ]

  worker_environment = concat(local.app_environment, [
    { name = "BACKGROUND_QUEUES_ENABLED", value = "true" },
    { name = "PAYMENT_DISPATCH_ENABLED", value = "true" },
  ])
}

resource "random_password" "database_master" {
  length  = 32
  special = false
}

resource "random_password" "redis_auth" {
  length  = 32
  special = false
}

resource "random_password" "jwt_access_secret" {
  length  = 48
  special = true
}

resource "random_password" "jwt_refresh_secret" {
  length  = 48
  special = true
}

resource "random_password" "payment_webhook_secret" {
  length  = 48
  special = true
}
