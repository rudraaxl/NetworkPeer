module "vpc" {
  source = "./modules/vpc"

  project            = var.project
  environment        = var.environment
  vpc_cidr           = var.vpc_cidr
  availability_zones = var.availability_zones
}

# Application security group is defined at root so RDS, ElastiCache, and ECS
# can all reference it without creating a module-level dependency cycle.
resource "aws_security_group" "app" {
  name        = "${var.project}-${var.environment}-app-sg"
  description = "Shared application security group"
  vpc_id      = module.vpc.vpc_id

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = {
    Name = "${var.project}-${var.environment}-app-sg"
  }
}

module "rds" {
  source = "./modules/rds"

  project                    = var.project
  environment                = var.environment
  vpc_id                     = module.vpc.vpc_id
  subnet_ids                 = module.vpc.database_subnet_ids
  database_name              = var.database_name
  master_username            = var.database_master_username
  master_password            = random_password.database_master.result
  allowed_security_group_ids = [aws_security_group.app.id]
}

module "elasticache" {
  source = "./modules/elasticache"

  project                    = var.project
  environment                = var.environment
  vpc_id                     = module.vpc.vpc_id
  subnet_ids                 = module.vpc.database_subnet_ids
  auth_token                 = random_password.redis_auth.result
  port                       = var.redis_port
  allowed_security_group_ids = [aws_security_group.app.id]
}

module "s3" {
  source = "./modules/s3"

  project     = var.project
  environment = var.environment
  bucket_name = var.s3_bucket_name
}

module "secrets" {
  source = "./modules/secrets-manager"

  project                = var.project
  environment            = var.environment
  database_url           = local.database_url
  redis_url              = local.redis_url
  jwt_access_secret      = random_password.jwt_access_secret.result
  jwt_refresh_secret     = random_password.jwt_refresh_secret.result
  payment_webhook_secret = random_password.payment_webhook_secret.result
}

module "ecs" {
  source = "./modules/ecs"

  project               = var.project
  environment           = var.environment
  aws_region            = var.aws_region
  vpc_id                = module.vpc.vpc_id
  public_subnet_ids     = module.vpc.public_subnet_ids
  private_subnet_ids    = module.vpc.private_subnet_ids
  app_security_group_id = aws_security_group.app.id
  api_image             = var.api_image
  worker_image          = var.worker_image
  api_cpu               = var.api_cpu
  api_memory            = var.api_memory
  worker_cpu            = var.worker_cpu
  worker_memory         = var.worker_memory
  api_desired_count     = var.api_desired_count
  worker_desired_count  = var.worker_desired_count
  app_port              = var.app_port
  api_environment       = local.app_environment
  worker_environment    = local.worker_environment
  s3_bucket_name        = module.s3.bucket_name
  s3_bucket_arn         = module.s3.bucket_arn
}

module "cloudflare" {
  source = "./modules/cloudflare"

  count = var.cloudflare_zone_id != "" ? 1 : 0

  zone_id          = var.cloudflare_zone_id
  api_domain       = var.api_domain
  web_domain       = var.web_domain
  api_alb_dns_name = module.ecs.api_alb_dns_name
}
