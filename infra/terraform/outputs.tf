output "evidence_bucket_name" {
  description = "Set this as AWS_S3_BUCKET in the runtime secret after bucket verification."
  value       = aws_s3_bucket.evidence.id
}

output "api_repository_url" {
  description = "Immutable API images are pushed here by a GitHub OIDC deployment workflow."
  value       = aws_ecr_repository.api.repository_url
}

output "worker_repository_url" {
  description = "Immutable worker images are pushed here by a GitHub OIDC deployment workflow."
  value       = aws_ecr_repository.worker.repository_url
}

output "migrator_repository_url" {
  description = "Immutable one-shot migration images are pushed here by the protected GitHub OIDC release workflow."
  value       = aws_ecr_repository.migrator.repository_url
}

output "runtime_secret_arn" {
  description = "Populate JSON values manually through the approved secret workflow before ECS service deployment."
  value       = aws_secretsmanager_secret.runtime.arn
}

output "cognito_user_pool_id" {
  description = "Cognito User Pool ID used by the API's Custom Auth broker."
  value       = aws_cognito_user_pool.main.id
}

output "cognito_user_pool_client_id" {
  description = "No-secret Cognito app client ID used by browser and native API authentication."
  value       = aws_cognito_user_pool_client.api.id
}

output "migration_secret_arn" {
  description = "Populate only for the one-shot migration/provisioning task."
  value       = aws_secretsmanager_secret.migration.arn
}

output "github_actions_deploy_role_arn" {
  description = "Compatibility output for the existing GitHub image-publishing role. Configure it as AWS_ECS_PUBLISH_ROLE_ARN."
  value       = aws_iam_role.github_actions_deploy.arn
}

output "github_actions_publish_role_arn" {
  description = "Protected GitHub Environment role limited to ECR image publishing."
  value       = aws_iam_role.github_actions_deploy.arn
}

output "github_actions_plan_role_arn" {
  description = "Protected GitHub Environment role limited to Terraform state access and infrastructure reads."
  value       = aws_iam_role.github_actions_plan.arn
}

output "github_actions_apply_role_arn" {
  description = "Protected GitHub Environment role for the scoped Terraform apply and one-shot migration task."
  value       = aws_iam_role.github_actions_apply.arn
}

output "vpc_id" {
  description = "Dedicated two-AZ NetworkPeer VPC ID."
  value       = aws_vpc.main.id
}

output "private_app_subnet_ids" {
  description = "Private application subnet IDs used by ECS tasks and the release migration task."
  value       = local.private_app_subnet_ids
}

output "ecs_tasks_security_group_id" {
  description = "Task ENI security group ID used by API, worker, and migration tasks."
  value       = aws_security_group.ecs_tasks.id
}

output "ecs_cluster_name" {
  description = "ECS cluster hosting the Fastify API, worker, and one-shot migration task."
  value       = aws_ecs_cluster.main.name
}

output "api_service_name" {
  description = "ECS service name for the Fastify API."
  value       = aws_ecs_service.api.name
}

output "worker_service_name" {
  description = "ECS service name for the background worker."
  value       = aws_ecs_service.worker.name
}

output "api_task_definition_arn" {
  description = "Expected API task definition ARN for post-release verification."
  value       = aws_ecs_task_definition.api.arn
}

output "worker_task_definition_arn" {
  description = "Expected worker task definition ARN for post-release verification."
  value       = aws_ecs_task_definition.worker.arn
}

output "api_target_group_arn" {
  description = "API ALB target group ARN for post-release target-health verification."
  value       = aws_lb_target_group.api.arn
}

output "migration_task_definition_arn" {
  description = "Run this task definition once after image publication and secret population, before activating services."
  value       = aws_ecs_task_definition.migration.arn
}

output "api_alb_dns_name" {
  description = "ALB DNS name. Do not expose it as the canonical client endpoint when a custom HTTPS domain is configured."
  value       = aws_lb.api.dns_name
}

output "api_url" {
  description = "Canonical HTTPS URL for the API: the custom domain when one is configured, otherwise the CloudFront distribution."
  value       = local.service_activation_endpoint_ready ? "https://${local.service_activation_endpoint_host}" : null
}

output "acm_dns_validation_records" {
  description = "DNS records required when Terraform requested an ACM certificate but cannot manage the hosted zone."
  value = local.create_managed_certificate ? [
    for option in aws_acm_certificate.application[0].domain_validation_options : {
      domain_name = option.domain_name
      name        = option.resource_record_name
      type        = option.resource_record_type
      value       = option.resource_record_value
    }
  ] : []
}

output "rds_endpoint" {
  description = "Private PostgreSQL hostname. Application URLs must use TLS with sslmode=require or stronger."
  value       = aws_db_instance.postgres.address
}

output "rds_port" {
  description = "PostgreSQL port."
  value       = aws_db_instance.postgres.port
}

output "rds_master_secret_arn" {
  description = "AWS-managed RDS master credential secret. Do not use this high-privilege credential as an application runtime secret."
  value       = try(one(aws_db_instance.postgres.master_user_secret).secret_arn, null)
}

output "redis_primary_endpoint" {
  description = "Private Redis primary endpoint. Build REDIS_URL manually with rediss:// and the approved AUTH token."
  value       = aws_elasticache_replication_group.redis.primary_endpoint_address
}

output "redis_reader_endpoint" {
  description = "Private Redis reader endpoint when replicas are enabled."
  value       = aws_elasticache_replication_group.redis.reader_endpoint_address
}

output "backup_vault_name" {
  description = "AWS Backup vault containing the independent RDS recovery-point policy."
  value       = aws_backup_vault.rds.name
}

output "operations_dashboard_name" {
  description = "CloudWatch dashboard containing ALB, ECS, RDS, and Redis operating signals."
  value       = aws_cloudwatch_dashboard.main.dashboard_name
}

output "public_site_url" {
  description = "Public HTTPS entrypoint for the client site and API. Null until enable_cloudfront is set."
  value       = var.enable_cloudfront ? "https://${aws_cloudfront_distribution.main[0].domain_name}" : null
}

output "web_bucket_name" {
  description = "S3 bucket the built client site is uploaded to. Null until enable_cloudfront is set."
  value       = var.enable_cloudfront ? aws_s3_bucket.web[0].id : null
}

output "cloudfront_distribution_id" {
  description = "CloudFront distribution to invalidate after uploading a new client build."
  value       = var.enable_cloudfront ? aws_cloudfront_distribution.main[0].id : null
}
