# ---------------------------------------------------------------------------
# Public entrypoint: CloudFront in front of the static client site (S3) and the
# API (ALB).
#
# NP-01: activation previously required an HTTPS listener, which required an ACM
# certificate, which required a domain. With no domain the release could never
# activate -- it parked production at zero, migrated, failed the precondition
# and rolled back. CloudFront supplies a trusted certificate on its own
# *.cloudfront.net name at no cost, which closes that loop without owning DNS.
#
# Serving both from one distribution also keeps the site same-origin with the
# API, so the browser never makes a cross-origin request and no CORS
# configuration is load-bearing for the product to work.
# ---------------------------------------------------------------------------

locals {
  cloudfront_enabled    = var.enable_cloudfront
  web_bucket_name       = coalesce(var.web_bucket_name, "${local.name_prefix}-web")
  cloudfront_s3_origin  = "web-s3"
  cloudfront_alb_origin = "api-alb"
}

resource "aws_s3_bucket" "web" {
  count = local.cloudfront_enabled ? 1 : 0

  bucket = local.web_bucket_name
}

resource "aws_s3_bucket_public_access_block" "web" {
  count = local.cloudfront_enabled ? 1 : 0

  bucket                  = aws_s3_bucket.web[0].id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_versioning" "web" {
  count = local.cloudfront_enabled ? 1 : 0

  bucket = aws_s3_bucket.web[0].id
  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "web" {
  count = local.cloudfront_enabled ? 1 : 0

  bucket = aws_s3_bucket.web[0].id
  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

# The bucket stays private; CloudFront reaches it with a signed request instead
# of the bucket being readable by the internet.
resource "aws_cloudfront_origin_access_control" "web" {
  count = local.cloudfront_enabled ? 1 : 0

  name                              = "${local.name_prefix}-web-oac"
  origin_access_control_origin_type = "s3"
  signing_behavior                  = "always"
  signing_protocol                  = "sigv4"
}

data "aws_iam_policy_document" "web_bucket" {
  count = local.cloudfront_enabled ? 1 : 0

  statement {
    sid       = "AllowCloudFrontRead"
    effect    = "Allow"
    actions   = ["s3:GetObject"]
    resources = ["${aws_s3_bucket.web[0].arn}/*"]

    principals {
      type        = "Service"
      identifiers = ["cloudfront.amazonaws.com"]
    }

    condition {
      test     = "StringEquals"
      variable = "AWS:SourceArn"
      values   = [aws_cloudfront_distribution.main[0].arn]
    }
  }
}

resource "aws_s3_bucket_policy" "web" {
  count = local.cloudfront_enabled ? 1 : 0

  bucket = aws_s3_bucket.web[0].id
  policy = data.aws_iam_policy_document.web_bucket[0].json
}

# API responses are per-user and must never be cached or collapsed between
# viewers; this is the AWS-managed "CachingDisabled" policy.
data "aws_cloudfront_cache_policy" "disabled" {
  count = local.cloudfront_enabled ? 1 : 0
  name  = "Managed-CachingDisabled"
}

# Forwards everything the API needs to authenticate and route a request.
data "aws_cloudfront_origin_request_policy" "all_viewer" {
  count = local.cloudfront_enabled ? 1 : 0
  name  = "Managed-AllViewerExceptHostHeader"
}

data "aws_cloudfront_cache_policy" "optimized" {
  count = local.cloudfront_enabled ? 1 : 0
  name  = "Managed-CachingOptimized"
}

resource "aws_cloudfront_distribution" "main" {
  count = local.cloudfront_enabled ? 1 : 0

  enabled             = true
  is_ipv6_enabled     = true
  comment             = "${local.name_prefix} public entrypoint"
  default_root_object = "index.html"
  price_class         = var.cloudfront_price_class

  origin {
    origin_id                = local.cloudfront_s3_origin
    domain_name              = aws_s3_bucket.web[0].bucket_regional_domain_name
    origin_access_control_id = aws_cloudfront_origin_access_control.web[0].id
  }

  origin {
    origin_id   = local.cloudfront_alb_origin
    domain_name = aws_lb.api.dns_name

    custom_origin_config {
      # The ALB has no certificate without a domain, so this hop is plaintext
      # inside AWS. It is not reachable from the internet: the ALB security
      # group accepts port 80 only from CloudFront's managed prefix list. Once a
      # domain and ACM certificate exist, set enable_https_listener and change
      # this to https-only to close the gap.
      origin_protocol_policy = var.enable_https_listener ? "https-only" : "http-only"
      http_port              = 80
      https_port             = 443
      origin_ssl_protocols   = ["TLSv1.2"]
    }
  }

  # The client site: a single-page app, so every unknown path returns the shell
  # and the browser router resolves it.
  default_cache_behavior {
    target_origin_id       = local.cloudfront_s3_origin
    viewer_protocol_policy = "redirect-to-https"
    allowed_methods        = ["GET", "HEAD", "OPTIONS"]
    cached_methods         = ["GET", "HEAD"]
    compress               = true
    cache_policy_id        = data.aws_cloudfront_cache_policy.optimized[0].id
  }

  ordered_cache_behavior {
    path_pattern           = "/api/v1/*"
    target_origin_id       = local.cloudfront_alb_origin
    viewer_protocol_policy = "https-only"
    allowed_methods        = ["GET", "HEAD", "OPTIONS", "PUT", "POST", "PATCH", "DELETE"]
    cached_methods         = ["GET", "HEAD"]
    compress               = true

    cache_policy_id          = data.aws_cloudfront_cache_policy.disabled[0].id
    origin_request_policy_id = data.aws_cloudfront_origin_request_policy.all_viewer[0].id
  }

  # index.html is the SPA shell, so a missing object is a client route, not an
  # error. S3 answers 403 for a missing key behind OAC, hence both codes.
  custom_error_response {
    error_code            = 403
    response_code         = 200
    response_page_path    = "/index.html"
    error_caching_min_ttl = 0
  }

  custom_error_response {
    error_code            = 404
    response_code         = 200
    response_page_path    = "/index.html"
    error_caching_min_ttl = 0
  }

  restrictions {
    geo_restriction {
      restriction_type = "none"
    }
  }

  viewer_certificate {
    cloudfront_default_certificate = true
    minimum_protocol_version       = "TLSv1.2_2021"
  }

  lifecycle {
    precondition {
      condition     = !var.enable_cloudfront || !var.enable_http_redirect
      error_message = "enable_cloudfront needs the ALB's port 80 to forward to the API, but enable_http_redirect turns port 80 into a redirect. Disable enable_http_redirect, or give the ALB a certificate and keep CloudFront off."
    }
  }
}

# Only CloudFront may reach the load balancer once it is the public entrypoint.
data "aws_ec2_managed_prefix_list" "cloudfront" {
  count = local.cloudfront_enabled ? 1 : 0
  name  = "com.amazonaws.global.cloudfront.origin-facing"
}

resource "aws_security_group_rule" "alb_from_cloudfront" {
  count = local.cloudfront_enabled ? 1 : 0

  type              = "ingress"
  security_group_id = aws_security_group.alb.id
  from_port         = 80
  to_port           = 80
  protocol          = "tcp"
  prefix_list_ids   = [data.aws_ec2_managed_prefix_list.cloudfront[0].id]
  description       = "CloudFront origin-facing ranges only"
}

# Port 80 forwards to the API when CloudFront terminates TLS in front of it.
# This is mutually exclusive with the redirect listener, enforced above.
resource "aws_lb_listener" "http_forward" {
  count = local.cloudfront_enabled && !var.enable_http_redirect ? 1 : 0

  load_balancer_arn = aws_lb.api.arn
  port              = 80
  protocol          = "HTTP"

  default_action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.api.arn
  }
}
