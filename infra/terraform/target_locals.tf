data "aws_caller_identity" "current" {}

data "aws_partition" "current" {}

data "aws_availability_zones" "available" {
  state = "available"
}

locals {
  selected_availability_zones = coalesce(var.availability_zones, slice(data.aws_availability_zones.available.names, 0, min(2, length(data.aws_availability_zones.available.names))))

  subnet_configuration = {
    for index, availability_zone in local.selected_availability_zones : availability_zone => {
      public_cidr       = var.public_subnet_cidrs[index]
      private_app_cidr  = var.private_app_subnet_cidrs[index]
      private_data_cidr = var.private_data_subnet_cidrs[index]
    }
  }

  first_availability_zone = local.selected_availability_zones[0]
  nat_gateway_azs = var.nat_gateway_mode == "none" ? toset([]) : (
    var.nat_gateway_mode == "single" ? toset([local.first_availability_zone]) : toset(local.selected_availability_zones)
  )

  alb_name               = trimsuffix(substr("${local.name_prefix}-api", 0, 32), "-")
  api_target_group_name  = trimsuffix(substr("${local.name_prefix}-api", 0, 32), "-")
  rds_identifier         = trimsuffix(substr("${local.name_prefix}-postgres", 0, 63), "-")
  redis_replication_name = trimsuffix(substr("${local.name_prefix}-redis", 0, 40), "-")
  backup_vault_name      = coalesce(var.backup_vault_name, "${local.name_prefix}-rds")

  private_app_subnet_ids = [
    for availability_zone in local.selected_availability_zones : aws_subnet.private_app[availability_zone].id
  ]
  private_data_subnet_ids = [
    for availability_zone in local.selected_availability_zones : aws_subnet.private_data[availability_zone].id
  ]
  public_subnet_ids = [
    for availability_zone in local.selected_availability_zones : aws_subnet.public[availability_zone].id
  ]

  # SES accepts "Display Name <user@example.com>" as a sender, but the
  # ses:FromAddress IAM condition key matches the bare address only.
  ses_from_address = var.email_from == null ? null : trimspace(
    length(regexall("<[^>]+>", var.email_from)) > 0
    ? trim(regex("<[^>]+>", var.email_from), "<>")
    : var.email_from
  )

  create_managed_certificate = var.domain_name != null && var.acm_certificate_arn == null
  manage_acm_dns_validation  = local.create_managed_certificate && var.route53_zone_id != null
  # No certificate exists while enable_https_listener is false, and coalesce()
  # errors rather than returning null when every argument is null. The HTTPS
  # listener that consumes this has count = 0 in that case, so null is correct.
  certificate_arn = try(coalesce(
    var.acm_certificate_arn,
    try(aws_acm_certificate_validation.application[0].certificate_arn, null),
    try(aws_acm_certificate.application[0].arn, null),
  ), null)
  # A deployment is reachable over trusted HTTPS either through its own domain
  # and certificate, or through CloudFront's own *.cloudfront.net certificate.
  # Requiring the first was NP-01: with no domain, activation could never
  # succeed, so every release parked production at zero and rolled back.
  service_activation_via_domain = var.enable_https_listener && (
    var.domain_name == null ? false : length(trimspace(var.domain_name)) > 0
  )
  service_activation_endpoint_ready = local.service_activation_via_domain || var.enable_cloudfront
  service_activation_endpoint_host = (
    local.service_activation_via_domain
    ? var.domain_name
    : (var.enable_cloudfront ? aws_cloudfront_distribution.main[0].domain_name : null)
  )
  # ALB source ENIs live only in these public subnets. Trusting this limited
  # range permits forwarded client metadata without trusting the whole VPC.
  trusted_alb_proxy_cidrs = join(",", var.public_subnet_cidrs)

  runtime_secret_keys = toset([
    # NP-04: absent from this set, the API fell back to the signing secret
    # committed to the public repository. It is required here, not optional.
    "JWT_SECRET",
    "DATABASE_URL",
    "DATABASE_ADMIN_URL",
    "DATABASE_MEDIA_VERIFIER_URL",
    "DATABASE_FINANCIAL_URL",
    "REDIS_URL",
    "AWS_REGION",
    "AWS_S3_BUCKET",
    "STRIPE_SECRET_KEY",
    "STRIPE_WEBHOOK_SECRET",
    "STRIPE_CONNECT_CLIENT_ID",
    "PAYMENT_WEBHOOK_SECRET",
    "FIREBASE_PROJECT_ID",
    "FIREBASE_CLIENT_EMAIL",
    "FIREBASE_PRIVATE_KEY",
    "SENTRY_DSN",
  ])

  migration_secret_keys = toset([
    "DATABASE_MIGRATION_URL",
    "NETWORKPEER_APP_DB_PASSWORD",
    "NETWORKPEER_ADMIN_DB_PASSWORD",
    "NETWORKPEER_MEDIA_DB_PASSWORD",
    "NETWORKPEER_FINANCIAL_DB_PASSWORD",
  ])

  runtime_secret_references = [
    for key in local.runtime_secret_keys : {
      name      = key
      valueFrom = "${aws_secretsmanager_secret.runtime.arn}:${key}::"
    }
  ]

  migration_secret_references = [
    for key in local.migration_secret_keys : {
      name      = key
      valueFrom = "${aws_secretsmanager_secret.migration.arn}:${key}::"
    }
  ]

  # These values satisfy production config.ts invariants and deliberately take
  # precedence over optional non-secret environment overrides.
  api_container_environment = merge(var.api_environment_variables, {
    NODE_ENV                          = "production"
    PORT                              = tostring(var.api_container_port)
    API_PREFIX                        = "/api/v1"
    ALLOW_INSECURE_INTERNAL_TRANSPORT = "false"
    COGNITO_USER_POOL_ID              = aws_cognito_user_pool.main.id
    COGNITO_CLIENT_ID                 = aws_cognito_user_pool_client.api.id
    COGNITO_REGION                    = var.aws_region
    COGNITO_CHALLENGE_TTL_SECONDS     = tostring(var.cognito_challenge_ttl_minutes * 60)
    COGNITO_REFRESH_TTL_SECONDS       = tostring(var.cognito_refresh_token_validity_days * 86400)
    CORS_ORIGINS                      = join(",", var.web_cors_origins)
    WEB_SESSION_COOKIE_SAME_SITE      = "none"
    WEB_SESSION_COOKIE_SECURE         = "true"
    PAYMENT_GATEWAY                   = "stripe"
    PAYMENT_DISPATCH_ENABLED          = "true"
    BACKGROUND_QUEUES_ENABLED         = "false"
    LOG_LEVEL                         = "info"
    LOG_PRETTY                        = "false"
    SENTRY_ENVIRONMENT                = var.environment
    TRUST_PROXY_CIDRS                 = local.trusted_alb_proxy_cidrs
    # OTP delivery. The API fails closed on the "log" provider in production,
    # so an unset provider surfaces as a 502 rather than a silent non-delivery.
    EMAIL_PROVIDER        = var.email_provider
    EMAIL_FROM            = coalesce(var.email_from, "")
    SES_REGION            = coalesce(var.ses_region, var.aws_region)
    SES_CONFIGURATION_SET = coalesce(var.ses_configuration_set, "")
  })

  worker_container_environment = merge(var.worker_environment_variables, {
    NODE_ENV                          = "production"
    API_PREFIX                        = "/api/v1"
    ALLOW_INSECURE_INTERNAL_TRANSPORT = "false"
    COGNITO_USER_POOL_ID              = aws_cognito_user_pool.main.id
    COGNITO_CLIENT_ID                 = aws_cognito_user_pool_client.api.id
    COGNITO_REGION                    = var.aws_region
    COGNITO_CHALLENGE_TTL_SECONDS     = tostring(var.cognito_challenge_ttl_minutes * 60)
    COGNITO_REFRESH_TTL_SECONDS       = tostring(var.cognito_refresh_token_validity_days * 86400)
    CORS_ORIGINS                      = join(",", var.web_cors_origins)
    WEB_SESSION_COOKIE_SAME_SITE      = "none"
    WEB_SESSION_COOKIE_SECURE         = "true"
    PAYMENT_GATEWAY                   = "stripe"
    PAYMENT_DISPATCH_ENABLED          = "true"
    BACKGROUND_QUEUES_ENABLED         = "true"
    LOG_LEVEL                         = "info"
    LOG_PRETTY                        = "false"
    SENTRY_ENVIRONMENT                = var.environment
  })

  migration_container_environment = merge({
    # The dedicated shell script enforces TLS for the migration URL. Development
    # mode avoids loading unrelated serving-process secrets during bootstrap.
    NODE_ENV = "development"
  }, var.migration_environment_variables)

  alarm_actions = var.alarm_sns_topic_arn == null ? [] : [var.alarm_sns_topic_arn]

  terraform_state_bucket_arn        = "arn:${data.aws_partition.current.partition}:s3:::${var.terraform_state_bucket_name}"
  terraform_lock_table_arn          = "arn:${data.aws_partition.current.partition}:dynamodb:${var.aws_region}:${data.aws_caller_identity.current.account_id}:table/${var.terraform_lock_table_name}"
  iam_role_arn_prefix               = "arn:${data.aws_partition.current.partition}:iam::${data.aws_caller_identity.current.account_id}:role/${local.name_prefix}-*"
  iam_policy_arn_prefix             = "arn:${data.aws_partition.current.partition}:iam::${data.aws_caller_identity.current.account_id}:policy/${local.name_prefix}-*"
  github_oidc_provider_expected_arn = "arn:${data.aws_partition.current.partition}:iam::${data.aws_caller_identity.current.account_id}:oidc-provider/token.actions.githubusercontent.com"
  github_oidc_subject = coalesce(
    var.github_oidc_subject,
    "repo:${var.github_repository}:environment:${var.github_environment}",
  )
}
