variable "project" {
  type = string
}

variable "environment" {
  type = string
}

variable "bucket_name" {
  type = string
}

locals {
  name_prefix = "${var.project}-${var.environment}"
}

resource "aws_s3_bucket" "evidence" {
  bucket        = var.bucket_name
  force_destroy = var.environment != "production"

  tags = {
    Name = "${local.name_prefix}-evidence"
  }
}

resource "aws_s3_bucket_versioning" "evidence" {
  bucket = aws_s3_bucket.evidence.id

  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "evidence" {
  bucket = aws_s3_bucket.evidence.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "aws_s3_bucket_public_access_block" "evidence" {
  bucket = aws_s3_bucket.evidence.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

# Evidence WORM: Object Lock prevents deletion/overwrite of accepted evidence.
resource "aws_s3_bucket_object_lock_configuration" "evidence" {
  bucket = aws_s3_bucket.evidence.id

  # Object Lock requires versioning and is immutable once enabled.
  rule {
    default_retention {
      mode  = "GOVERNANCE"
      years = 7
    }
  }
}

resource "aws_s3_bucket_lifecycle_configuration" "evidence" {
  bucket = aws_s3_bucket.evidence.id

  rule {
    id     = "expire-abandoned-pending-evidence"
    status = "Enabled"

    filter {
      tag {
        key   = "networkpeer-evidence-state"
        value = "pending"
      }
    }

    expiration {
      days = 1
    }

    noncurrent_version_expiration {
      noncurrent_days = 30
    }
  }
}

resource "aws_s3_bucket_cors_configuration" "evidence" {
  bucket = aws_s3_bucket.evidence.id

  cors_rule {
    allowed_headers = ["*"]
    allowed_methods = ["POST"]
    allowed_origins = var.environment == "production" ? ["https://networkpeer.example.com"] : ["http://localhost:8080"]
    expose_headers  = ["ETag"]
    max_age_seconds = 300
  }
}

output "bucket_name" {
  value = aws_s3_bucket.evidence.id
}

output "bucket_arn" {
  value = aws_s3_bucket.evidence.arn
}
