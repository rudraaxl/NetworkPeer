variable "terraform_state_bucket_name" {
  description = "Name of the pre-existing dedicated S3 bucket that stores Terraform state. It is used only to scope GitHub OIDC state access."
  type        = string

  validation {
    condition     = can(regex("^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$", var.terraform_state_bucket_name))
    error_message = "terraform_state_bucket_name must be a valid lowercase S3 bucket name."
  }
}

variable "terraform_lock_table_name" {
  description = "Name of the pre-existing DynamoDB Terraform state lock table."
  type        = string

  validation {
    condition     = length(trimspace(var.terraform_lock_table_name)) > 0
    error_message = "terraform_lock_table_name must not be empty."
  }
}

variable "github_environment" {
  description = "Exact protected GitHub Environment name permitted to assume plan, apply, and image-publish roles."
  type        = string
  default     = "production"

  validation {
    condition     = can(regex("^[A-Za-z0-9_.-]{1,255}$", var.github_environment))
    error_message = "github_environment may contain letters, digits, periods, underscores, and hyphens."
  }
}

variable "github_oidc_subject" {
  description = "Optional exact GitHub OIDC sub claim. Leave null for repo:owner/repository:environment:name; set the immutable-subject form when the repository has opted into it."
  type        = string
  default     = null
  nullable    = true
}

variable "availability_zones" {
  description = "Optional explicit two-AZ placement. When null, Terraform selects the first two available AZs in aws_region."
  type        = list(string)
  default     = null
  nullable    = true

  validation {
    condition     = var.availability_zones == null || (length(var.availability_zones) == 2 && length(distinct(var.availability_zones)) == 2)
    error_message = "availability_zones must be null or exactly two distinct Availability Zones."
  }
}

variable "vpc_cidr" {
  description = "RFC1918 CIDR for the dedicated application VPC. Verify it does not overlap connected networks."
  type        = string
  default     = "10.42.0.0/16"

  validation {
    condition     = can(cidrhost(var.vpc_cidr, 0))
    error_message = "vpc_cidr must be a valid IPv4 or IPv6 CIDR block."
  }
}

variable "public_subnet_cidrs" {
  description = "Exactly two public subnet CIDRs, one per selected AZ, for ALB and NAT gateways."
  type        = list(string)
  default     = ["10.42.0.0/20", "10.42.16.0/20"]

  validation {
    condition     = length(var.public_subnet_cidrs) == 2 && alltrue([for cidr in var.public_subnet_cidrs : can(cidrhost(cidr, 0))])
    error_message = "public_subnet_cidrs must contain exactly two valid CIDRs."
  }
}

variable "private_app_subnet_cidrs" {
  description = "Exactly two private application subnet CIDRs, one per selected AZ, for ECS tasks and interface endpoints."
  type        = list(string)
  default     = ["10.42.32.0/20", "10.42.48.0/20"]

  validation {
    condition     = length(var.private_app_subnet_cidrs) == 2 && alltrue([for cidr in var.private_app_subnet_cidrs : can(cidrhost(cidr, 0))])
    error_message = "private_app_subnet_cidrs must contain exactly two valid CIDRs."
  }
}

variable "private_data_subnet_cidrs" {
  description = "Exactly two isolated private data subnet CIDRs, one per selected AZ, for RDS and ElastiCache."
  type        = list(string)
  default     = ["10.42.64.0/20", "10.42.80.0/20"]

  validation {
    condition     = length(var.private_data_subnet_cidrs) == 2 && alltrue([for cidr in var.private_data_subnet_cidrs : can(cidrhost(cidr, 0))])
    error_message = "private_data_subnet_cidrs must contain exactly two valid CIDRs."
  }
}

variable "nat_gateway_mode" {
  description = "NAT mode: none for AWS-endpoint-only egress, single for lower-cost non-production egress, or per_az for resilient production egress."
  type        = string
  default     = "single"

  validation {
    condition     = contains(["none", "single", "per_az"], var.nat_gateway_mode)
    error_message = "nat_gateway_mode must be none, single, or per_az."
  }
}

variable "enable_interface_vpc_endpoints" {
  description = "Whether to create private interface endpoints for ECS image pulls, logs, Secrets Manager, STS, and KMS. They have hourly and data-processing charges."
  type        = bool
  default     = true
}

variable "interface_vpc_endpoint_services" {
  description = "AWS service suffixes for interface endpoints. Keep the default set when nat_gateway_mode is none."
  type        = set(string)
  default = [
    "ecr.api",
    "ecr.dkr",
    "logs",
    "secretsmanager",
    "sts",
    "kms",
    "cognito-idp",
  ]

  validation {
    condition     = alltrue([for service in var.interface_vpc_endpoint_services : can(regex("^[a-z0-9.-]+$", service))])
    error_message = "Each interface endpoint service must use a valid AWS service suffix."
  }
}

variable "cognito_challenge_ttl_minutes" {
  description = "Cognito Custom Auth session lifetime in minutes. It must match the OTP delivery message and remain within Cognito's supported 3-15 minute range."
  type        = number
  default     = 5

  validation {
    condition     = var.cognito_challenge_ttl_minutes >= 3 && var.cognito_challenge_ttl_minutes <= 15 && floor(var.cognito_challenge_ttl_minutes) == var.cognito_challenge_ttl_minutes
    error_message = "cognito_challenge_ttl_minutes must be a whole number from 3 through 15."
  }
}

variable "cognito_max_attempts" {
  description = "Maximum Custom Auth OTP attempts before Cognito rejects the authentication session."
  type        = number
  default     = 5

  validation {
    condition     = var.cognito_max_attempts >= 1 && var.cognito_max_attempts <= 10 && floor(var.cognito_max_attempts) == var.cognito_max_attempts
    error_message = "cognito_max_attempts must be a whole number from 1 through 10."
  }
}

variable "cognito_refresh_token_validity_days" {
  description = "Cognito refresh-token and browser session lifetime in days. The API supports at most 30 days."
  type        = number
  default     = 7

  validation {
    condition     = var.cognito_refresh_token_validity_days >= 1 && var.cognito_refresh_token_validity_days <= 30 && floor(var.cognito_refresh_token_validity_days) == var.cognito_refresh_token_validity_days
    error_message = "cognito_refresh_token_validity_days must be a whole number from 1 through 30."
  }
}

variable "cognito_sms_sender_id" {
  description = "Optional registered alphanumeric AWS SNS SMS sender ID. Leave null where sender IDs are unsupported."
  type        = string
  default     = null
  nullable    = true

  validation {
    condition     = var.cognito_sms_sender_id == null || can(regex("^[A-Za-z0-9]{1,11}$", var.cognito_sms_sender_id))
    error_message = "cognito_sms_sender_id must be null or 1-11 alphanumeric characters."
  }
}

variable "cognito_sms_origination_number" {
  description = "Optional registered AWS SNS E.164 origination number. Leave null to use the account's regional default."
  type        = string
  default     = null
  nullable    = true

  validation {
    condition     = var.cognito_sms_origination_number == null || can(regex("^\\+[1-9][0-9]{1,14}$", var.cognito_sms_origination_number))
    error_message = "cognito_sms_origination_number must be null or an E.164 phone number."
  }
}

variable "cognito_sms_message_template" {
  description = "Transactional OTP message for the Cognito Custom Auth Lambda. It must contain {code}; {minutes} is replaced with the configured session lifetime."
  type        = string
  default     = "Your NetworkPeer verification code is {code}. It expires in {minutes} minutes."

  validation {
    condition     = length(trimspace(var.cognito_sms_message_template)) > 0 && strcontains(var.cognito_sms_message_template, "{code}")
    error_message = "cognito_sms_message_template must be non-empty and contain {code}."
  }
}

variable "enable_s3_gateway_endpoint" {
  description = "Whether to add the no-hourly-cost S3 gateway endpoint to private ECS route tables."
  type        = bool
  default     = true
}

variable "enable_vpc_flow_logs" {
  description = "Whether to publish all VPC flow logs to CloudWatch Logs. This improves investigation at additional ingestion/storage cost."
  type        = bool
  default     = true
}

variable "vpc_flow_log_retention_days" {
  description = "CloudWatch retention for VPC flow logs."
  type        = number
  default     = 30

  validation {
    condition     = contains([1, 3, 5, 7, 14, 30, 60, 90, 120, 150, 180, 365, 400, 545, 731, 1096, 1827, 2192, 2557, 2922, 3288, 3653], var.vpc_flow_log_retention_days)
    error_message = "vpc_flow_log_retention_days must be a supported CloudWatch Logs retention period."
  }
}

variable "api_container_port" {
  description = "Container port exposed by the Fastify API."
  type        = number
  default     = 3000

  validation {
    condition     = var.api_container_port >= 1 && var.api_container_port <= 65535
    error_message = "api_container_port must be between 1 and 65535."
  }
}

variable "api_health_check_path" {
  description = "Unauthenticated Fastify dependency health endpoint used by the ALB target group."
  type        = string
  default     = "/api/v1/health"

  validation {
    condition     = startswith(var.api_health_check_path, "/")
    error_message = "api_health_check_path must begin with a slash."
  }
}

variable "alb_idle_timeout_seconds" {
  description = "ALB idle timeout. Keep this high enough for expected WebSocket idle traffic and send application ping frames before it expires."
  type        = number
  default     = 120

  validation {
    condition     = var.alb_idle_timeout_seconds >= 1 && var.alb_idle_timeout_seconds <= 4000
    error_message = "alb_idle_timeout_seconds must be between 1 and 4000."
  }
}

variable "alb_deletion_protection" {
  description = "Whether ALB deletion protection is enabled. Set false explicitly only before a deliberate teardown."
  type        = bool
  default     = true
}

variable "enable_https_listener" {
  description = "Whether to create the public HTTPS listener. Service activation additionally requires this listener and an explicit canonical domain_name. Requires acm_certificate_arn, or domain_name plus route53_zone_id."
  type        = bool
  default     = true
}

variable "enable_http_redirect" {
  description = "Whether to expose port 80 solely to redirect HTTP requests to HTTPS."
  type        = bool
  default     = true
}

variable "acm_certificate_arn" {
  description = "Optional existing issued ACM certificate ARN in aws_region. Prefer this for externally managed DNS."
  type        = string
  default     = null
  nullable    = true
}

variable "domain_name" {
  description = "Canonical public API DNS name. It is optional for parked infrastructure, but required with HTTPS before API or worker service activation."
  type        = string
  default     = null
  nullable    = true

  validation {
    condition     = var.domain_name == null || can(regex("^[A-Za-z0-9][A-Za-z0-9.-]*\\.[A-Za-z0-9][A-Za-z0-9-]*$", var.domain_name))
    error_message = "domain_name must be a DNS name without a scheme, path, wildcard, or trailing period."
  }
}

variable "additional_domain_names" {
  description = "Optional additional ACM subject alternative names. Each needs its own DNS validation record."
  type        = set(string)
  default     = []
}

variable "route53_zone_id" {
  description = "Optional existing Route53 hosted zone ID. When set with domain_name, Terraform creates ACM validation and ALB alias records."
  type        = string
  default     = null
  nullable    = true

  validation {
    condition     = var.route53_zone_id == null || can(regex("^Z[A-Z0-9]+$", var.route53_zone_id))
    error_message = "route53_zone_id must be an AWS hosted zone ID beginning with Z."
  }
}

variable "enable_waf" {
  description = "Whether to associate a regional AWS WAF web ACL with the ALB. Enable after reviewing managed-rule behavior and recurring cost."
  type        = bool
  default     = false
}

variable "waf_rate_limit" {
  description = "Per-source-IP five-minute request limit for the WAF rate-based rule."
  type        = number
  default     = 2000

  validation {
    condition     = var.waf_rate_limit >= 100
    error_message = "waf_rate_limit must be at least 100."
  }
}

variable "api_image_tag" {
  description = "Immutable ECR tag for the API task definition. Release workflows supply a commit SHA."
  type        = string
  default     = "bootstrap"
}

variable "worker_image_tag" {
  description = "Immutable ECR tag for the worker task definition. Release workflows supply a commit SHA."
  type        = string
  default     = "bootstrap"
}

variable "migrator_image_tag" {
  description = "Immutable ECR tag for the one-shot migration task definition. Release workflows supply a commit SHA."
  type        = string
  default     = "bootstrap"
}

variable "allow_service_activation" {
  description = "Release-only gate for API and worker service capacity. Leave false for generic Terraform plans and applies so bootstrap or stale task definitions cannot run."
  type        = bool
  default     = false
}

variable "api_task_cpu" {
  description = "Fargate CPU units for the API task."
  type        = number
  default     = 512

  validation {
    condition     = contains([256, 512, 1024, 2048, 4096, 8192, 16384], var.api_task_cpu)
    error_message = "api_task_cpu must be a valid Fargate CPU value."
  }
}

variable "api_task_memory" {
  description = "Fargate memory MiB for the API task. Select a value valid for api_task_cpu."
  type        = number
  default     = 1024
}

variable "worker_task_cpu" {
  description = "Fargate CPU units for the worker task."
  type        = number
  default     = 512

  validation {
    condition     = contains([256, 512, 1024, 2048, 4096, 8192, 16384], var.worker_task_cpu)
    error_message = "worker_task_cpu must be a valid Fargate CPU value."
  }
}

variable "worker_task_memory" {
  description = "Fargate memory MiB for the worker task. Select a value valid for worker_task_cpu."
  type        = number
  default     = 1024
}

variable "migrator_task_cpu" {
  description = "Fargate CPU units for the one-shot migration task."
  type        = number
  default     = 512

  validation {
    condition     = contains([256, 512, 1024, 2048, 4096, 8192, 16384], var.migrator_task_cpu)
    error_message = "migrator_task_cpu must be a valid Fargate CPU value."
  }
}

variable "migrator_task_memory" {
  description = "Fargate memory MiB for the one-shot migration task. Select a value valid for migrator_task_cpu."
  type        = number
  default     = 1024
}

variable "ecs_cpu_architecture" {
  description = "CPU architecture for published ECS images. Release builds publish AMD64 images only."
  type        = string
  default     = "X86_64"

  validation {
    condition     = var.ecs_cpu_architecture == "X86_64"
    error_message = "ecs_cpu_architecture must be X86_64 until the release workflow builds and verifies ARM64 images."
  }
}

variable "api_container_command" {
  description = "Optional API command override. Leave empty to use the image CMD."
  type        = list(string)
  default     = []
}

variable "worker_container_command" {
  description = "Worker command override for the shared runtime image. The production runtime contains compiled dist files but no tsx/source tree."
  type        = list(string)
  default     = ["node", "dist/background-worker.js"]
}

variable "migration_container_command" {
  description = "Optional migration command override. Leave empty to use the Docker migrator target CMD, which runs migrate-and-provision.sh."
  type        = list(string)
  default     = []
}

variable "api_environment_variables" {
  description = "Additional non-secret API environment variables. Task definitions enforce Cognito, browser-cookie, payment, queue, and JSON logging settings over any same-named values here."
  type        = map(string)
  default     = {}
}

variable "worker_environment_variables" {
  description = "Additional non-secret worker environment variables. Task definitions enforce Cognito, browser-cookie, payment, queue, and JSON logging settings over any same-named values here."
  type        = map(string)
  default     = {}
}

variable "migration_environment_variables" {
  description = "Non-secret migrator environment variables. Put credentials and database URLs in the migration Secrets Manager JSON instead."
  type        = map(string)
  default     = {}
}

variable "api_desired_count" {
  description = "API desired task count used only when allow_service_activation is true. Generic Terraform remains parked at zero."
  type        = number
  default     = 1

  validation {
    condition     = var.api_desired_count >= 0
    error_message = "api_desired_count cannot be negative."
  }
}

variable "worker_desired_count" {
  description = "Worker desired task count used only when allow_service_activation is true. Generic Terraform remains parked at zero."
  type        = number
  default     = 1

  validation {
    condition     = var.worker_desired_count >= 0
    error_message = "worker_desired_count cannot be negative."
  }
}

variable "api_min_capacity" {
  description = "Minimum API desired count used only when allow_service_activation is true. Generic Terraform sets the scaling minimum to zero."
  type        = number
  default     = 1

  validation {
    condition     = var.api_min_capacity >= 0
    error_message = "api_min_capacity cannot be negative."
  }
}

variable "api_max_capacity" {
  description = "Maximum API desired count managed by ECS Service Auto Scaling."
  type        = number
  default     = 4

  validation {
    condition     = var.api_max_capacity >= 1
    error_message = "api_max_capacity must be at least one."
  }
}

variable "worker_min_capacity" {
  description = "Minimum worker desired count used only when allow_service_activation is true. Generic Terraform sets the scaling minimum to zero."
  type        = number
  default     = 1

  validation {
    condition     = var.worker_min_capacity >= 0
    error_message = "worker_min_capacity cannot be negative."
  }
}

variable "worker_max_capacity" {
  description = "Maximum worker desired count managed by ECS Service Auto Scaling."
  type        = number
  default     = 4

  validation {
    condition     = var.worker_max_capacity >= 1
    error_message = "worker_max_capacity must be at least one."
  }
}

variable "api_cpu_target_percent" {
  description = "Target ECS service average CPU utilization for API scaling."
  type        = number
  default     = 60
}

variable "api_memory_target_percent" {
  description = "Target ECS service average memory utilization for API scaling."
  type        = number
  default     = 70
}

variable "worker_cpu_target_percent" {
  description = "Target ECS service average CPU utilization for worker scaling."
  type        = number
  default     = 65
}

variable "ecs_enable_fargate_spot_for_worker" {
  description = "Whether the worker service uses Fargate Spot. Do not enable for jobs that cannot tolerate interruption or duplicate delivery."
  type        = bool
  default     = false
}

variable "enable_ecs_exec" {
  description = "Whether to enable ECS Exec for API and worker debugging. It adds SSM channel permissions and should be protected operationally."
  type        = bool
  default     = false
}

variable "ecs_log_retention_days" {
  description = "CloudWatch retention for API and worker logs."
  type        = number
  default     = 30
}

variable "migration_log_retention_days" {
  description = "CloudWatch retention for migration logs."
  type        = number
  default     = 90
}

variable "postgres_engine_version" {
  description = "Pinned RDS PostgreSQL engine version. Choose a version supported by the selected region and parameter group family."
  type        = string
  default     = "16.4"
}

variable "postgres_parameter_group_family" {
  description = "RDS PostgreSQL parameter group family matching postgres_engine_version, for example postgres16."
  type        = string
  default     = "postgres16"
}

variable "rds_instance_class" {
  description = "RDS instance class. db.t4g.medium is a cost-aware starting point; size from load testing."
  type        = string
  default     = "db.t4g.medium"
}

variable "rds_allocated_storage_gb" {
  description = "Initial gp3 storage allocation for PostgreSQL."
  type        = number
  default     = 50
}

variable "rds_max_allocated_storage_gb" {
  description = "Maximum storage autoscaling ceiling for PostgreSQL."
  type        = number
  default     = 100
}

variable "rds_multi_az" {
  description = "Whether RDS uses a synchronous Multi-AZ standby. Enable for production resilience; it materially increases cost."
  type        = bool
  default     = false
}

variable "rds_backup_retention_days" {
  description = "RDS automated-backup retention period. AWS Backup provides an additional independent policy."
  type        = number
  default     = 7

  validation {
    condition     = var.rds_backup_retention_days >= 1 && var.rds_backup_retention_days <= 35
    error_message = "rds_backup_retention_days must be between 1 and 35."
  }
}

variable "rds_deletion_protection" {
  description = "Whether RDS deletion protection is enabled. Set false explicitly before a deliberate teardown."
  type        = bool
  default     = true
}

variable "rds_skip_final_snapshot" {
  description = "Whether to skip the final RDS snapshot during destruction. Keep false outside disposable sandboxes."
  type        = bool
  default     = false
}

variable "rds_final_snapshot_identifier" {
  description = "Optional unique RDS final snapshot identifier. Defaults to a predictable name and should be overridden when recreating an environment."
  type        = string
  default     = null
  nullable    = true
}

variable "rds_database_name" {
  description = "Initial PostgreSQL database name. Database roles and PostGIS are created by the one-shot migrator."
  type        = string
  default     = "networkpeer"
}

variable "rds_master_username" {
  description = "Non-secret RDS master username. AWS generates and manages its password in a Secrets Manager secret."
  type        = string
  default     = "networkpeer_master"
}

variable "rds_preferred_backup_window" {
  description = "UTC RDS backup window in hh:mm-hh:mm format."
  type        = string
  default     = "03:00-03:30"
}

variable "rds_preferred_maintenance_window" {
  description = "UTC RDS maintenance window."
  type        = string
  default     = "sun:04:00-sun:04:30"
}

variable "rds_monitoring_interval_seconds" {
  description = "RDS Enhanced Monitoring interval. Zero disables it; 60 is a cost-aware production starting point."
  type        = number
  default     = 60

  validation {
    condition     = contains([0, 1, 5, 10, 15, 30, 60], var.rds_monitoring_interval_seconds)
    error_message = "rds_monitoring_interval_seconds must be 0, 1, 5, 10, 15, 30, or 60."
  }
}

variable "rds_performance_insights_enabled" {
  description = "Whether to enable RDS Performance Insights. Review regional pricing and retention before enabling longer retention."
  type        = bool
  default     = true
}

variable "rds_performance_insights_retention_period" {
  description = "Performance Insights retention days. Seven days is included for supported RDS engines."
  type        = number
  default     = 7
}

variable "rds_apply_immediately" {
  description = "Whether RDS modifications apply immediately. Keep false for controlled maintenance windows."
  type        = bool
  default     = false
}

variable "rds_log_retention_days" {
  description = "CloudWatch retention for exported PostgreSQL logs."
  type        = number
  default     = 30
}

variable "redis_auth_token" {
  description = "Existing approved Redis AUTH token supplied through a protected runtime variable, never a tfvars file. AWS requires plaintext at cache creation, so encrypted Terraform state is mandatory."
  type        = string
  sensitive   = true
  nullable    = false

  validation {
    condition = (
      length(var.redis_auth_token) >= 16 &&
      length(var.redis_auth_token) <= 128 &&
      alltrue([for forbidden in ["/", "\"", "@", ","] : !strcontains(var.redis_auth_token, forbidden)])
    )
    error_message = "redis_auth_token must be 16-128 characters and cannot contain slash, double quote, at sign, or comma."
  }
}

variable "redis_node_type" {
  description = "ElastiCache node type. cache.t4g.small is a cost-aware starting point; validate memory and connection load."
  type        = string
  default     = "cache.t4g.small"
}

variable "redis_engine_version" {
  description = "Pinned Redis OSS engine version supported in the selected region."
  type        = string
  default     = "7.1"
}

variable "redis_parameter_group_name" {
  description = "ElastiCache parameter group compatible with redis_engine_version."
  type        = string
  default     = "default.redis7"
}

variable "redis_num_cache_clusters" {
  description = "Number of cache nodes in the replication group. Use two with automatic failover for HA, or one only for lower-cost non-production."
  type        = number
  default     = 2
}

variable "redis_automatic_failover_enabled" {
  description = "Whether Redis automatic failover is enabled. Requires at least two cache nodes."
  type        = bool
  default     = true
}

variable "redis_multi_az_enabled" {
  description = "Whether Redis node placement spans AZs. Requires automatic failover and at least two cache nodes."
  type        = bool
  default     = true
}

variable "redis_snapshot_retention_limit" {
  description = "Number of daily Redis snapshots retained by ElastiCache."
  type        = number
  default     = 7
}

variable "redis_snapshot_window" {
  description = "UTC daily Redis snapshot window."
  type        = string
  default     = "04:30-05:30"
}

variable "redis_maintenance_window" {
  description = "UTC Redis maintenance window."
  type        = string
  default     = "sun:05:00-sun:06:00"
}

variable "redis_apply_immediately" {
  description = "Whether ElastiCache modifications apply immediately. Keep false for controlled maintenance windows."
  type        = bool
  default     = false
}

variable "redis_log_retention_days" {
  description = "CloudWatch retention for Redis engine and slow logs."
  type        = number
  default     = 30
}

variable "alarm_sns_topic_arn" {
  description = "Optional existing SNS topic ARN for CloudWatch alarm notifications. Terraform does not create subscriptions."
  type        = string
  default     = null
  nullable    = true
}

variable "alarm_evaluation_periods" {
  description = "Default number of evaluation periods used by operational alarms."
  type        = number
  default     = 3
}

variable "rds_cpu_alarm_threshold" {
  description = "RDS CPU utilization percentage that triggers an alarm."
  type        = number
  default     = 80
}

variable "rds_free_storage_alarm_bytes" {
  description = "Free storage byte threshold that triggers an RDS alarm."
  type        = number
  default     = 10737418240
}

variable "rds_connection_alarm_threshold" {
  description = "RDS database connection count that triggers an alarm."
  type        = number
  default     = 80
}

variable "redis_cpu_alarm_threshold" {
  description = "Redis engine CPU utilization percentage that triggers an alarm."
  type        = number
  default     = 75
}

variable "backup_vault_name" {
  description = "Optional AWS Backup vault name. Defaults to the environment name prefix."
  type        = string
  default     = null
  nullable    = true
}

variable "backup_schedule" {
  description = "AWS Backup cron expression for the independent RDS recovery-point policy."
  type        = string
  default     = "cron(0 5 ? * * *)"
}

variable "backup_delete_after_days" {
  description = "Days AWS Backup retains RDS recovery points. Must exceed any cold-storage transition by 90 days."
  type        = number
  default     = 35

  validation {
    condition     = var.backup_delete_after_days >= 1
    error_message = "backup_delete_after_days must be at least one."
  }
}

variable "backup_vault_lock_min_retention_days" {
  description = "Optional immutable AWS Backup Vault Lock minimum retention. Enabling this can prevent Terraform destroy until retention expires."
  type        = number
  default     = null
  nullable    = true
}

variable "backup_vault_lock_max_retention_days" {
  description = "Optional AWS Backup Vault Lock maximum retention. Required only when enforcing a maximum retention."
  type        = number
  default     = null
  nullable    = true
}

variable "backup_vault_lock_changeable_for_days" {
  description = "AWS Backup Vault Lock grace period before the lock becomes immutable."
  type        = number
  default     = 3

  validation {
    condition     = var.backup_vault_lock_changeable_for_days >= 3
    error_message = "backup_vault_lock_changeable_for_days must be at least three."
  }
}

variable "email_provider" {
  description = "OTP email transport. \"ses\" uses Amazon SES in ses_region. \"log\" delivers nothing and the API fails closed on it in production, so it must not be used for a live environment."
  type        = string
  default     = "ses"

  validation {
    condition     = contains(["ses", "resend", "log"], var.email_provider)
    error_message = "email_provider must be ses, resend, or log."
  }
}

variable "email_from" {
  description = "Envelope sender for OTP email. The domain or address must be a verified SES identity in ses_region before sending succeeds."
  type        = string
  default     = null
  nullable    = true

  validation {
    condition     = var.email_from == null || can(regex("^[^<>]*<?[^@<>]+@[A-Za-z0-9.-]+\\.[A-Za-z]{2,}>?$", var.email_from))
    error_message = "email_from must be an email address, optionally in \"Display Name <user@example.com>\" form."
  }
}

variable "ses_region" {
  description = "Region holding the verified SES identity. Defaults to aws_region; set it only when the identity lives elsewhere."
  type        = string
  default     = null
  nullable    = true
}

variable "ses_configuration_set" {
  description = "Optional SES configuration set for bounce and complaint tracking."
  type        = string
  default     = null
  nullable    = true
}

variable "enable_cloudfront" {
  description = "Serve the client site and API through a CloudFront distribution. Supplies trusted HTTPS on *.cloudfront.net without owning a domain (NP-01)."
  type        = bool
  default     = false
}

variable "web_bucket_name" {
  description = "S3 bucket holding the built client site. Defaults to <project>-<environment>-web."
  type        = string
  default     = null
}

variable "cloudfront_price_class" {
  description = "CloudFront edge coverage. PriceClass_100 is the cheapest and covers North America and Europe."
  type        = string
  default     = "PriceClass_100"

  validation {
    condition     = contains(["PriceClass_100", "PriceClass_200", "PriceClass_All"], var.cloudfront_price_class)
    error_message = "cloudfront_price_class must be PriceClass_100, PriceClass_200 or PriceClass_All."
  }
}
