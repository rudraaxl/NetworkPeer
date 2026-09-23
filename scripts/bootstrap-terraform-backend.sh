#!/usr/bin/env bash
# Creates the S3 bucket and DynamoDB table that hold Terraform state.
#
# The main configuration deliberately does not create these: Terraform cannot
# store its own state in resources it is in the middle of creating. Run this
# once per account, before `terraform init`.
#
# Safe to re-run -- every step checks for an existing resource first.
set -euo pipefail

REGION="${AWS_REGION:-ap-south-1}"
ACCOUNT="$(aws sts get-caller-identity --query Account --output text)"
BUCKET="${TF_STATE_BUCKET:-networkpeer-tfstate-${ACCOUNT}}"
TABLE="${TF_LOCK_TABLE:-networkpeer-tflock}"

echo "Account : $ACCOUNT"
echo "Region  : $REGION"
echo "Bucket  : $BUCKET"
echo "Table   : $TABLE"
echo

if aws s3api head-bucket --bucket "$BUCKET" 2>/dev/null; then
  echo "Bucket already exists, leaving it alone."
else
  echo "Creating state bucket..."
  # us-east-1 rejects a LocationConstraint; every other region requires one.
  if [[ "$REGION" == "us-east-1" ]]; then
    aws s3api create-bucket --bucket "$BUCKET" --region "$REGION"
  else
    aws s3api create-bucket --bucket "$BUCKET" --region "$REGION" \
      --create-bucket-configuration "LocationConstraint=$REGION"
  fi
fi

# State contains resource identifiers and any value marked sensitive, so it is
# versioned (to recover a corrupted apply) and encrypted, and never public.
aws s3api put-bucket-versioning --bucket "$BUCKET" \
  --versioning-configuration Status=Enabled

aws s3api put-bucket-encryption --bucket "$BUCKET" \
  --server-side-encryption-configuration \
  '{"Rules":[{"ApplyServerSideEncryptionByDefault":{"SSEAlgorithm":"AES256"}}]}'

aws s3api put-public-access-block --bucket "$BUCKET" \
  --public-access-block-configuration \
  'BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true'

if aws dynamodb describe-table --table-name "$TABLE" --region "$REGION" >/dev/null 2>&1; then
  echo "Lock table already exists, leaving it alone."
else
  echo "Creating lock table..."
  aws dynamodb create-table \
    --table-name "$TABLE" \
    --region "$REGION" \
    --attribute-definitions AttributeName=LockID,AttributeType=S \
    --key-schema AttributeName=LockID,KeyType=HASH \
    --billing-mode PAY_PER_REQUEST >/dev/null
  aws dynamodb wait table-exists --table-name "$TABLE" --region "$REGION"
fi

echo
echo "Done. Put these in infra/terraform/backend.hcl:"
echo "  bucket         = \"$BUCKET\""
echo "  dynamodb_table = \"$TABLE\""
echo "  region         = \"$REGION\""
