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

variable "database_name" {
  type = string
}

variable "master_username" {
  type = string
}

variable "master_password" {
  type      = string
  sensitive = true
}

variable "allowed_security_group_ids" {
  type = list(string)
}

locals {
  name_prefix = "${var.project}-${var.environment}"
}

resource "aws_db_subnet_group" "main" {
  name       = "${local.name_prefix}-rds-subnet"
  subnet_ids = var.subnet_ids

  tags = {
    Name = "${local.name_prefix}-rds-subnet"
  }
}

resource "aws_security_group" "rds" {
  name        = "${local.name_prefix}-rds-sg"
  description = "Allow PostgreSQL access from application services"
  vpc_id      = var.vpc_id

  ingress {
    description     = "PostgreSQL"
    from_port       = 5432
    to_port         = 5432
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
    Name = "${local.name_prefix}-rds-sg"
  }
}

resource "aws_db_instance" "main" {
  identifier = "${local.name_prefix}-postgis"

  engine         = "postgres"
  engine_version = "16.3"
  instance_class = var.environment == "production" ? "db.t3.medium" : "db.t3.micro"

  db_name  = var.database_name
  username = var.master_username
  password = var.master_password
  port     = 5432

  allocated_storage     = var.environment == "production" ? 50 : 20
  max_allocated_storage = 200
  storage_encrypted     = true
  storage_type          = "gp3"

  multi_az               = var.environment == "production"
  publicly_accessible    = false
  db_subnet_group_name   = aws_db_subnet_group.main.name
  vpc_security_group_ids = [aws_security_group.rds.id]

  backup_retention_period = var.environment == "production" ? 30 : 7
  backup_window           = "03:00-04:00"
  maintenance_window      = "sun:04:00-sun:05:00"

  enabled_cloudwatch_logs_exports = ["postgresql"]
  performance_insights_enabled    = true
  deletion_protection             = var.environment == "production"

  skip_final_snapshot       = var.environment != "production"
  final_snapshot_identifier = "${local.name_prefix}-final-${formatdate("YYYYMMDD-hhmmss", timestamp())}"

  tags = {
    Name = "${local.name_prefix}-postgis"
  }
}

output "endpoint" {
  description = "RDS endpoint (host:port)"
  value       = aws_db_instance.main.endpoint
}

output "database_name" {
  value = aws_db_instance.main.db_name
}
