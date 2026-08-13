variable "project" {
  type = string
}

variable "environment" {
  type = string
}

variable "vpc_id" {
  type = string
}

variable "subnet_ids" {
  type = list(string)
}

variable "auth_token" {
  type      = string
  sensitive = true
}

variable "port" {
  type = number
}

variable "allowed_security_group_ids" {
  type = list(string)
}

locals {
  name_prefix = "${var.project}-${var.environment}"
}

resource "aws_elasticache_subnet_group" "main" {
  name       = "${local.name_prefix}-redis-subnet"
  subnet_ids = var.subnet_ids

  tags = {
    Name = "${local.name_prefix}-redis-subnet"
  }
}

resource "aws_security_group" "redis" {
  name        = "${local.name_prefix}-redis-sg"
  description = "Allow Redis access from application services"
  vpc_id      = var.vpc_id

  ingress {
    description     = "Redis"
    from_port       = var.port
    to_port         = var.port
    protocol        = "tcp"
    security_groups = var.allowed_security_group_ids
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = {
    Name = "${local.name_prefix}-redis-sg"
  }
}

resource "aws_elasticache_replication_group" "main" {
  replication_group_id       = "${local.name_prefix}-redis"
  description                = "NetworkPeer Redis"
  engine                     = "redis"
  engine_version             = "7.1"
  node_type                  = var.environment == "production" ? "cache.t3.small" : "cache.t3.micro"
  num_cache_clusters         = 1
  automatic_failover_enabled = false
  port                       = var.port
  parameter_group_name       = "default.redis7"

  subnet_group_name  = aws_elasticache_subnet_group.main.name
  security_group_ids = [aws_security_group.redis.id]

  auth_token                 = var.auth_token
  transit_encryption_enabled = true
  at_rest_encryption_enabled = true

  apply_immediately = true

  tags = {
    Name = "${local.name_prefix}-redis"
  }
}

output "endpoint" {
  description = "Redis primary endpoint"
  value       = aws_elasticache_replication_group.main.primary_endpoint_address
}

output "port" {
  value = aws_elasticache_replication_group.main.port
}
