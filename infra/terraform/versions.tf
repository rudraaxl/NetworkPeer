terraform {
  required_version = ">= 1.5.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
    random = {
      source  = "hashicorp/random"
      version = "~> 3.6"
    }
    cloudflare = {
      source  = "cloudflare/cloudflare"
      version = "~> 4.0"
    }
  }

  backend "s3" {
    # Override these values per environment in a backend config file:
    #   terraform init -backend-config=env/staging.s3.tfbackend
    bucket         = "networkpeer-terraform-state"
    key            = "networkpeer/staging/terraform.tfstate"
    region         = "ap-south-1"
    encrypt        = true
    dynamodb_table = "networkpeer-terraform-locks"
  }
}

provider "aws" {
  region = var.aws_region

  default_tags {
    tags = {
      Project     = "networkpeer"
      Environment = var.environment
      ManagedBy   = "terraform"
    }
  }
}

provider "random" {}

provider "cloudflare" {
  api_token = var.cloudflare_api_token
}
