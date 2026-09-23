#!/usr/bin/env bash
# Builds the client site and publishes it to S3 behind CloudFront.
#
# The CloudFront distribution and its S3 bucket were created directly rather
# than through Terraform, because the Terraform in this repository does not
# describe the running infrastructure (a plan reports 123 to add and 72 to
# destroy). So this discovers them from AWS by the distribution's comment
# instead of reading Terraform outputs, and nothing has to be kept in sync by
# hand. Override either value with WEB_BUCKET / CLOUDFRONT_DISTRIBUTION_ID.
#
# Run from the repository root with AWS credentials already in your shell.
set -euo pipefail

COMMENT="${CLOUDFRONT_COMMENT:-networkpeer-staging public entrypoint}"

command -v aws >/dev/null || { echo "aws CLI not found on PATH" >&2; exit 1; }

distribution="${CLOUDFRONT_DISTRIBUTION_ID:-}"
if [[ -z "$distribution" ]]; then
  distribution="$(aws cloudfront list-distributions \
    --query "DistributionList.Items[?Comment=='${COMMENT}'].Id | [0]" --output text)"
fi
if [[ -z "$distribution" || "$distribution" == "None" ]]; then
  echo "No CloudFront distribution found with comment: ${COMMENT}" >&2
  echo "Set CLOUDFRONT_DISTRIBUTION_ID explicitly, or check your AWS credentials." >&2
  exit 1
fi

# The bucket is whichever S3 origin the distribution serves the site from, so a
# rebuilt distribution is picked up without editing this script.
bucket="${WEB_BUCKET:-}"
if [[ -z "$bucket" ]]; then
  bucket="$(aws cloudfront get-distribution --id "$distribution" \
    --query "Distribution.DistributionConfig.Origins.Items[?S3OriginConfig].DomainName | [0]" \
    --output text)"
  bucket="${bucket%%.s3.*}"
fi
if [[ -z "$bucket" || "$bucket" == "None" ]]; then
  echo "Could not determine the S3 origin bucket for distribution ${distribution}" >&2
  exit 1
fi

domain="$(aws cloudfront get-distribution --id "$distribution" \
  --query 'Distribution.DomainName' --output text)"

echo "distribution : $distribution"
echo "bucket       : $bucket"
echo "url          : https://${domain}"
echo

echo "Building client site..."
npm run build --workspace networkpeer-web

dist="apps/web/dist/client"
[[ -f "$dist/index.html" ]] || { echo "Build produced no $dist/index.html" >&2; exit 1; }

# Fingerprinted asset names change whenever their contents change, so they can
# be cached forever. index.html keeps the same name and names the current
# assets, so caching it would keep serving the previous app after a deploy.
echo "Uploading assets..."
aws s3 sync "$dist" "s3://${bucket}" \
  --delete \
  --exclude "index.html" \
  --exclude "_shell.html" \
  --cache-control "public,max-age=31536000,immutable" \
  --only-show-errors

aws s3 cp "$dist/index.html" "s3://${bucket}/index.html" \
  --cache-control "no-cache,no-store,must-revalidate" \
  --content-type "text/html; charset=utf-8" \
  --only-show-errors

# Only the entry document needs invalidating: every other file is content
# addressed, so a changed file is always a new path CloudFront has never cached.
echo "Invalidating the entry document..."
invalidation="$(aws cloudfront create-invalidation \
  --distribution-id "$distribution" \
  --paths "/" "/index.html" \
  --query 'Invalidation.Id' --output text)"

echo "Waiting for invalidation ${invalidation}..."
aws cloudfront wait invalidation-completed \
  --distribution-id "$distribution" --id "$invalidation"

echo
echo "Deployed: https://${domain}"
