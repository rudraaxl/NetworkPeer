# NetworkPeer — Railway + S3 Deployment Runbook

This gets the backend, database, Redis, and evidence storage live on free/cheap
hosted infrastructure without buying a domain. It uses:

- **Railway** — Fastify API, PostgreSQL/PostGIS, Redis
- **AWS S3** — evidence media (the only AWS dependency)
- **Vercel** (optional) — web frontend
- **Expo Go** — mobile testing

> **Important:** This runbook runs the API with `NODE_ENV=development` because the
> production config requires Stripe, Twilio, distinct DB principals, and TLS-only
> URLs. Development mode is acceptable for a free hosted beta/demo, but **do not
> put real customer data or real payments through it**. For production, use the
> Terraform + AWS + Cloudflare path in `infra/terraform/`.

---

## 0. What you need first

- A GitHub account (free)
- A Railway account (free trial gives $5 credit; a card is required)
- An AWS account (free tier; card required for signup)
- A Vercel account (free, only if deploying the web app)

---

## 1. Set up AWS S3 (evidence storage)

The backend uses the AWS S3 SDK for presigned evidence uploads, so you need a
private, versioned, encrypted S3 bucket.

### 1.1 Install AWS CLI

```bash
brew install awscli
aws configure
# Enter: Access Key ID, Secret Access Key, region = ap-south-1, output = json
```

### 1.2 Create the bucket with the required controls

```bash
AWS_REGION=ap-south-1
BUCKET=networkpeer-media-staging

aws s3 mb "s3://${BUCKET}" --region "$AWS_REGION"

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
```

### 1.3 Create an IAM user with S3 access

In the AWS Console: **IAM → Users → Create user → Programmatic access**, then
attach an inline policy with these permissions (replace `<bucket>`):

```json
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
        "arn:aws:s3:::<bucket>",
        "arn:aws:s3:::<bucket>/*"
      ]
    }
  ]
}
```

Copy the **Access Key ID** and **Secret Access Key**. You'll paste them into
Railway's environment variables in the next step.

### 1.4 Set bucket CORS for the presigned POST flow

```bash
cat > /tmp/networkpeer-s3-cors.json <<EOF
{
  "CORSRules": [
    {
      "AllowedHeaders": ["*"],
      "AllowedMethods": ["POST"],
      "AllowedOrigins": ["http://localhost:8080", "http://localhost:5173"],
      "ExposeHeaders": ["ETag"],
      "MaxAgeSeconds": 300
    }
  ]
}
EOF

aws s3api put-bucket-cors \
  --bucket "$BUCKET" \
  --cors-configuration file:///tmp/networkpeer-s3-cors.json
```

> Add your deployed Vercel/Expo origin to `AllowedOrigins` once you know it.

---

## 2. Deploy the backend to Railway

### 2.1 Push the repo to GitHub

```bash
cd /Users/rudraaxlakra/Downloads/NETWORKPEER
git add -A
git commit -m "Productionize backend, web, mobile, and compliance layer"
git remote add origin https://github.com/<your-username>/Networkpeer.git
git push -u origin main
```

### 2.2 Create the Railway services

1. Go to railway.app → **New Project**
2. **Deploy from GitHub** → select your repo
3. Add three plugins/services:
   - **PostgreSQL** (this gives `DATABASE_URL`)
   - **Redis** (this gives `REDIS_URL`)
   - **API service** from the repo

### 2.3 Configure the API service

Set the **Root Directory** to the repo root (NOT `apps/api`). This is critical
because the npm workspaces and shared contracts package live at the root.

**Build command:**
```bash
npm ci && npm run build:contracts && npm run build --workspace networkpeer-api
```

**Start command:**
```bash
node apps/api/dist/index.js
```

**Environment variables** (Railway → Variables tab):

```bash
NODE_ENV=development
PORT=3000
API_PREFIX=/api/v1

# Railway injects these automatically via the plugin references:
DATABASE_URL=${{Postgres.DATABASE_URL}}
REDIS_URL=${{Redis.REDIS_URL}}

# Privileged URLs can be empty in development; they fall back to DATABASE_URL.
DATABASE_ADMIN_URL=
DATABASE_MEDIA_VERIFIER_URL=
DATABASE_FINANCIAL_URL=

JWT_SECRET=<openssl rand -hex 48>
JWT_REFRESH_SECRET=<openssl rand -hex 48>
JWT_ACCESS_TTL=15m
JWT_REFRESH_TTL=7d
JWT_ISSUER=networkpeer-api
JWT_AUDIENCE=networkpeer-mobile

# Development-only auth (do NOT use in production):
OTP_ECHO_IN_RESPONSE=true
SMS_PROVIDER=console

# AWS S3 evidence storage:
AWS_REGION=ap-south-1
AWS_S3_BUCKET=networkpeer-media-staging
AWS_ACCESS_KEY_ID=<your IAM access key>
AWS_SECRET_ACCESS_KEY=<your IAM secret key>
AWS_SESSION_TOKEN=

# Development-only payment gateway:
PAYMENT_GATEWAY=stub
PAYMENT_WEBHOOK_SECRET=<openssl rand -hex 48>
PLATFORM_FEE_BPS=0
PAYMENT_DISPATCH_ENABLED=true

CORS_ORIGINS=https://<your-vercel-origin>,http://localhost:8080
REALTIME_ENABLED=true
BACKGROUND_QUEUES_ENABLED=true
LOG_LEVEL=info
LOG_PRETTY=false

RATE_LIMIT_WINDOW_MS=60000
RATE_LIMIT_MAX_REQUESTS=100
```

### 2.4 Run migrations (one-time)

Railway does not run migrations automatically. Run them once from your Mac
against the Railway Postgres URL:

```bash
cd /Users/rudraaxlakra/Downloads/NETWORKPEER/apps/api

export NODE_ENV=test
export DATABASE_URL="<paste Railway Postgres DATABASE_URL>?sslmode=require"
export REDIS_URL="<paste Railway Redis REDIS_URL>"
export PAYMENT_GATEWAY=stub
export PAYMENT_WEBHOOK_SECRET=ci-payment-webhook-secret-1234567890
export PAYMENT_DISPATCH_ENABLED=false
export BACKGROUND_QUEUES_ENABLED=false
export LOG_PRETTY=false
npm run migrate
```

> Railway's Postgres URL may not include `sslmode=require`. Append it manually.
> The `NODE_ENV=test` setting avoids the strict production validation, which
> requires Stripe/Twilio and is not relevant for the free beta.

### 2.5 Verify the API

Open in a browser:

```
https://<your-service>.up.railway.app/api/v1/live
```

Should return:

```json
{"success":true,"data":{"status":"live"},"error":null}
```

And:

```
https://<your-service>.up.railway.app/api/v1/health
```

Should return `database: true`.

### 2.6 (Optional) Deploy the background worker

Create a second service from the same repo:

- Root Directory: `apps/api`
- Start command: `node dist/background-worker.js`
- Same environment variables, plus `BACKGROUND_QUEUES_ENABLED=true`

For the demo you can skip this — the API runs queues in-process by default.

---

## 3. Deploy the web frontend to Vercel

1. vercel.com → **New Project** → import your repo
2. **Root Directory** = `apps/web`
3. Framework preset = **Other (Nitro)**
4. Environment variables:

```bash
NITRO_PRESET=vercel
VITE_API_BASE_URL=https://<your-service>.up.railway.app/api/v1
VITE_API_PREFIX=/api/v1
```

5. Deploy, then copy the Vercel URL (e.g. `https://networkpeer.vercel.app`)
6. Add that exact origin to the backend's `CORS_ORIGINS` on Railway and redeploy

---

## 4. Run the mobile app against the deployed API

```bash
cd /Users/rudraaxlakra/Downloads/NETWORKPEER/apps/mobile

# Point Expo at the hosted API (no local backend needed):
EXPO_PUBLIC_API_URL=https://<your-service>.up.railway.app npm start
```

Scan the QR with Expo Go. Log in with any phone number — the OTP is echoed on
screen in development mode.

Walk the full flow:

```
OTP → nearby jobs → accept → capture evidence → submit → wallet
```

---

## 5. Smoke-test the full money loop (stub gateway)

Because `PAYMENT_GATEWAY=stub` and the OTP is echoed, you can test everything
without Stripe or Twilio:

1. **Client** (normal browser): sign up → create job → fund escrow
2. **Settle the stub webhook** so the job becomes `POSTED` (use the existing
   `scripts/simulate-payment-webhook.mjs`, or the web app's dev settler page)
3. **Worker** (Expo/incognito): find nearby → accept → capture → submit
4. **Client**: review evidence → approve → wallet updates

The stub gateway never moves real money; it only exercises the same ledger
settlement path as Stripe.

---

## 6. What this deployment is and isn't

**Good for:**
- Beta testing with real devices
- Demonstrating the complete worker + client journey
- Validating the API, evidence, and ledger flows end-to-end

**NOT good for:**
- Real payments (stub gateway)
- Real SMS login (console OTP echo)
- Real customer data (development mode, no strict production validation)
- Scale (Railway free tier)

For a production launch, switch to `NODE_ENV=production`, add Stripe + Twilio,
and use the Terraform AWS + Cloudflare path in `infra/terraform/`.

---

## Troubleshooting

| Problem | Fix |
|---|---|
| `/api/v1/health` returns 503 | Check `DATABASE_URL` has `?sslmode=require` and PostGIS extension is enabled |
| CORS error in browser | Add the exact Vercel origin to `CORS_ORIGINS` and redeploy backend |
| Evidence upload fails | Verify S3 bucket versioning + encryption are enabled, IAM keys have correct policy |
| OTP not showing | Confirm `OTP_ECHO_IN_RESPONSE=true` and `SMS_PROVIDER=console` |
| Migrations fail | Run `npm run migrate` from `apps/api` with the Railway DB URL |
| Worker queues not running | Set `BACKGROUND_QUEUES_ENABLED=true` or deploy the worker service |
