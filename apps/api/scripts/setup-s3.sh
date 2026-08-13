#!/bin/sh
# One-command S3 evidence bucket setup for the NetworkPeer Railway deploy.
# Requires the AWS CLI to be installed and configured with credentials that
# have s3:CreateBucket and the IAM permissions below.
set -eu

BUCKET="${AWS_S3_BUCKET:-networkpeer-media-staging}"
REGION="${AWS_REGION:-ap-south-1}"

echo "Ensuring S3 bucket exists: $BUCKET ($REGION)"

# The bucket may already exist from an earlier run. `aws s3 mb` fails with
# BucketAlreadyOwnedByYou in that case, which is fine for idempotent setup.
if aws s3api head-bucket --bucket "$BUCKET" 2>/dev/null; then
  echo "Bucket $BUCKET already exists; skipping creation."
else
  aws s3 mb "s3://${BUCKET}" --region "$REGION"
fi

aws s3api put-bucket-versioning \
  --bucket "$BUCKET" \
  --versioning-configuration Status=Enabled

aws s3api put-bucket-encryption \
  --bucket "$BUCKET" \
  --server-side-encryption-configuration '{
    "Rules": [{
      "ApplyServerSideEncryptionByDefault": {"SSEAlgorithm": "AES256"}
    }]
  }'

aws s3api put-public-access-block \
  --bucket "$BUCKET" \
  --public-access-block-configuration '{
    "BlockPublicAcls": true,
    "IgnorePublicAcls": true,
    "BlockPublicPolicy": true,
    "RestrictPublicBuckets": true
  }'

# Presigned POST uploads come from local dev and the deployed web/mobile origins.
aws s3api put-bucket-cors \
  --bucket "$BUCKET" \
  --cors-configuration '{
    "CORSRules": [{
      "AllowedHeaders": ["*"],
      "AllowedMethods": ["POST"],
      "AllowedOrigins": [
        "http://localhost:8080",
        "http://localhost:5173",
        "https://networkpeer.vercel.app"
      ],
      "ExposeHeaders": ["ETag"],
      "MaxAgeSeconds": 300
    }]
  }'

echo ""
echo "Bucket $BUCKET is ready."
echo ""
echo "Next: create an IAM user with this inline policy (replace the bucket name):"
cat <<'POLICY'
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "s3:PutObject",
        "s3:GetObject",
        "s3:PutObjectTagging",
        "s3:GetBucketPublicAccessBlock",
        "s3:GetEncryptionConfiguration",
        "s3:GetBucketVersioning",
        "s3:PutBucketCORS",
        "s3:ListBucket"
      ],
      "Resource": [
        "arn:aws:s3:::BUCKET_NAME_HERE",
        "arn:aws:s3:::BUCKET_NAME_HERE/*"
      ]
    }
  ]
}
POLICY
echo ""
echo "Then put the IAM Access Key ID and Secret Access Key into Railway env vars."
