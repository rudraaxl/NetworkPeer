#!/usr/bin/env bash
# Builds the client site and publishes it to S3 behind CloudFront.
#
# Reads the bucket and distribution from Terraform outputs so there is nothing
# to keep in sync by hand. Run from the repository root with AWS credentials
# already in your shell (aws sso login, or aws configure).
set -euo pipefail

TF_DIR="${TF_DIR:-infra/terraform}"

bucket="$(terraform -chdir="$TF_DIR" output -raw web_bucket_name)"
distribution="$(terraform -chdir="$TF_DIR" output -raw cloudfront_distribution_id)"
site_url="$(terraform -chdir="$TF_DIR" output -raw public_site_url)"

if [[ -z "$bucket" || "$bucket" == "null" ]]; then
  echo "No web bucket in Terraform outputs. Set enable_cloudfront=true and apply first." >&2
  exit 1
fi

echo "Building client site..."
npm run build --workspace networkpeer-web

dist="apps/web/dist/client"
[[ -f "$dist/index.html" ]] || { echo "Build produced no $dist/index.html" >&2; exit 1; }

# Fingerprinted assets are immutable and cached hard; the HTML shell must never
# be cached, or a deploy would keep serving the previous app.
echo "Uploading assets to s3://$bucket ..."
aws s3 sync "$dist" "s3://$bucket" \
  --delete \
  --exclude "index.html" \
  --exclude "_shell.html" \
  --cache-control "public,max-age=31536000,immutable"

aws s3 cp "$dist/index.html" "s3://$bucket/index.html" \
  --cache-control "no-cache,no-store,must-revalidate" \
  --content-type "text/html; charset=utf-8"

echo "Invalidating CloudFront..."
aws cloudfront create-invalidation \
  --distribution-id "$distribution" \
  --paths "/index.html" "/" \
  --query 'Invalidation.Id' --output text

echo "Done: $site_url"
