#!/usr/bin/env node
// Verify the S3 evidence bucket is ready for NetworkPeer and set its CORS.
// Usage: node scripts/verify-s3-setup.mjs [extra-origin...]
// Reads AWS_* from .env (via dotenv) and defaults the CORS origin to http://localhost:8080.
import "dotenv/config";
import { randomUUID } from "node:crypto";
import s3Pkg from "@aws-sdk/client-s3";
import presignPkg from "@aws-sdk/s3-presigned-post";

const {
  S3Client,
  PutBucketCorsCommand,
  GetBucketVersioningCommand,
  GetPublicAccessBlockCommand,
  GetBucketEncryptionCommand,
} = s3Pkg;
const { createPresignedPost } = presignPkg;

const bucket = process.env.AWS_S3_BUCKET;
const region = process.env.AWS_REGION;
if (!bucket || !process.env.AWS_ACCESS_KEY_ID || !process.env.AWS_SECRET_ACCESS_KEY) {
  console.error("Missing AWS_* values in .env (AWS_S3_BUCKET, AWS_REGION, AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY).");
  process.exit(1);
}

const extraOrigins = process.argv.slice(2).filter((value) => value.startsWith("http"));
const origins = ["http://localhost:8080", ...extraOrigins];
const client = new S3Client({ region });

function report(name, ok, detail) {
  console.log(`${ok ? "✅" : "❌"} ${name}${detail ? ` — ${detail}` : ""}`);
  return ok;
}

let allGood = true;

// 1) CORS so the browser can upload straight from the frontend origin(s).
const corsRules = {
  CORSRules: [
    {
      AllowedHeaders: ["*"],
      AllowedMethods: ["POST"],
      AllowedOrigins: origins,
      ExposeHeaders: ["ETag"],
      MaxAgeSeconds: 300,
    },
  ],
};
try {
  await client.send(new PutBucketCorsCommand({ Bucket: bucket, CORSConfiguration: corsRules }));
  report("Bucket CORS", true, `allowed: ${origins.join(", ")}`);
} catch (error) {
  allGood =
    report(
      "Bucket CORS",
      false,
      error instanceof Error ? error.message : String(error),
    ) && allGood;
}

// 2) Versioning must be enabled (the app pins S3 VersionIds for evidence).
try {
  const versioning = await client.send(new GetBucketVersioningCommand({ Bucket: bucket }));
  allGood = report("Bucket versioning", versioning.Status === "Enabled", String(versioning.Status)) && allGood;
} catch (error) {
  allGood = report("Bucket versioning", false, error instanceof Error ? error.message : String(error)) && allGood;
}

// 3) All public-access blocks must be on.
try {
  const block = await client.send(new GetPublicAccessBlockCommand({ Bucket: bucket }));
  const { BlockPublicAcls, IgnorePublicAcls, BlockPublicPolicy, RestrictPublicBuckets } = block.PublicAccessBlockConfiguration ?? {};
  const blocked = BlockPublicAcls && IgnorePublicAcls && BlockPublicPolicy && RestrictPublicBuckets;
  allGood = report("Public access blocked", blocked === true, JSON.stringify({ BlockPublicAcls, IgnorePublicAcls, BlockPublicPolicy, RestrictPublicBuckets })) && allGood;
} catch (error) {
  allGood = report("Public access blocked", false, error instanceof Error ? error.message : String(error)) && allGood;
}

// 4) Default encryption must be on.
try {
  const encryption = await client.send(new GetBucketEncryptionCommand({ Bucket: bucket }));
  const rule = encryption.ServerSideEncryptionConfiguration?.Rules?.[0];
  const type = rule?.ApplyServerSideEncryptionByDefault?.SSEAlgorithm ?? "none";
  allGood = report("Default encryption", type === "AES256" || type === "aws:kms", type) && allGood;
} catch (error) {
  allGood = report("Default encryption", false, error instanceof Error ? error.message : String(error)) && allGood;
}

// 5) Presigned POST generation with these exact keys (what the worker upload uses).
try {
  const key = `evidence/setup-verify-${randomUUID()}.jpg`;
  const post = await createPresignedPost(client, {
    Bucket: bucket,
    Key: key,
    Expires: 300,
    Conditions: [
      { "Content-Type": "image/jpeg" },
      ["content-length-range", 1, 26_214_400],
    ],
  });
  report("Presigned POST signing", true, `fields: ${Object.keys(post.fields).join(", ")} (url ${post.url})`);
} catch (error) {
  allGood = report("Presigned POST signing", false, error instanceof Error ? error.message : String(error)) && allGood;
}

console.log(allGood ? "\n✅ Bucket is ready for NetworkPeer evidence uploads." : "\n❌ Fix the failing checks above.");
process.exit(allGood ? 0 : 1);
