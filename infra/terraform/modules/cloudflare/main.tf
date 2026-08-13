terraform {
  required_providers {
    cloudflare = {
      source  = "cloudflare/cloudflare"
      version = "~> 4.0"
    }
  }
}

variable "zone_id" {
  description = "Cloudflare zone ID"
  type        = string
}

variable "api_domain" {
  description = "API domain name"
  type        = string
}

variable "web_domain" {
  description = "Web domain name"
  type        = string
}

variable "api_alb_dns_name" {
  description = "AWS ALB DNS name to proxy API traffic to"
  type        = string
}

variable "web_origin" {
  description = "Origin for the web app (e.g. Vercel or Cloudflare Pages hostname)"
  type        = string
  default     = ""
}

# API record: proxied through Cloudflare to the AWS ALB.
resource "cloudflare_record" "api" {
  zone_id = var.zone_id
  name    = var.api_domain
  content = var.api_alb_dns_name
  type    = "CNAME"
  proxied = true
  ttl     = 1
}

# Web record: typically a CNAME to the frontend host (Vercel/Pages) or a direct
# origin. If no explicit web origin is set, use the API domain as a placeholder
# so the record is still defined and can be updated later.
resource "cloudflare_record" "web" {
  zone_id = var.zone_id
  name    = var.web_domain
  content = var.web_origin != "" ? var.web_origin : var.api_alb_dns_name
  type    = "CNAME"
  proxied = true
  ttl     = 1
}

# WAF rule: block obvious malicious paths at the edge before they reach AWS.
resource "cloudflare_ruleset" "api_waf" {
  zone_id     = var.zone_id
  name        = "NetworkPeer API WAF"
  description = "Block common attack patterns before AWS"
  kind        = "zone"
  phase       = "http_request_firewall_managed"

  rules {
    action      = "block"
    expression  = "(http.request.uri.path contains \"/wp-admin\") or (http.request.uri.path contains \"/.env\") or (http.request.uri.path contains \"/phpmyadmin\")"
    description = "Block sensitive and common scanner paths"
    enabled     = true
  }
}
