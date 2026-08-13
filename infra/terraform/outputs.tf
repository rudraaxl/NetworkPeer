output "vpc_id" {
  description = "VPC ID"
  value       = module.vpc.vpc_id
}

output "public_subnet_ids" {
  description = "Public subnet IDs"
  value       = module.vpc.public_subnet_ids
}

output "private_subnet_ids" {
  description = "Private subnet IDs"
  value       = module.vpc.private_subnet_ids
}

output "database_endpoint" {
  description = "RDS endpoint"
  value       = module.rds.endpoint
}

output "database_name" {
  description = "Database name"
  value       = var.database_name
}

output "redis_endpoint" {
  description = "ElastiCache Redis endpoint"
  value       = module.elasticache.endpoint
}

output "redis_port" {
  description = "Redis port"
  value       = var.redis_port
}

output "s3_bucket_name" {
  description = "S3 evidence bucket name"
  value       = module.s3.bucket_name
}

output "s3_bucket_arn" {
  description = "S3 evidence bucket ARN"
  value       = module.s3.bucket_arn
}

output "api_alb_dns_name" {
  description = "API load balancer DNS name"
  value       = module.ecs.api_alb_dns_name
}

output "api_service_name" {
  description = "API ECS service name"
  value       = module.ecs.api_service_name
}

output "worker_service_name" {
  description = "Worker ECS service name"
  value       = module.ecs.worker_service_name
}
