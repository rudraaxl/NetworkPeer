import {
  GetBucketEncryptionCommand,
  GetObjectCommand,
  GetPublicAccessBlockCommand,
  GetBucketVersioningCommand,
  HeadObjectCommand,
  PutObjectTaggingCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { createPresignedPost } from "@aws-sdk/s3-presigned-post";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { config } from "../config.js";

export type MediaUploadTarget = {
  url: string;
  fields: Record<string, string>;
};

export type StoredMediaObject = {
  contentLength: number | null;
  contentType: string | null;
  checksumSha256Base64: string | null;
  etag: string | null;
  versionId: string | null;
};

export interface MediaStorage {
  assertReady?(): Promise<void>;
  createUploadTarget(input: {
    bucket: string;
    key: string;
    mimeType: string;
    checksumSha256Base64: string;
    maxUploadBytes: number;
  }): Promise<MediaUploadTarget>;
  headObject(input: { bucket: string; key: string; versionId?: string }): Promise<StoredMediaObject>;
  setObjectState(input: {
    bucket: string;
    key: string;
    versionId: string;
    state: "pending" | "confirmed";
  }): Promise<void>;
  createDownloadUrl(input: {
    bucket: string;
    key: string;
    versionId?: string;
    expiresInSeconds?: number;
  }): Promise<string>;
  getObjectBytes?(input: {
    bucket: string;
    key: string;
    versionId?: string;
  }): Promise<Buffer>;
}

/** S3 implementation used in production; tests can inject a MediaStorage fake. */
export class S3MediaStorage implements MediaStorage {
  private readonly client: S3Client;

  constructor(client?: S3Client) {
    this.client = client ?? new S3Client({
      region: config.AWS_REGION,
      credentials: config.AWS_ACCESS_KEY_ID
        ? {
            accessKeyId: config.AWS_ACCESS_KEY_ID,
            secretAccessKey: config.AWS_SECRET_ACCESS_KEY,
            sessionToken: config.AWS_SESSION_TOKEN || undefined,
          }
        : undefined,
    });
  }

  /**
   * Fail closed in production when the bucket cannot preserve private,
   * version-pinned evidence. This deliberately requires the runtime IAM role
   * to have the three read-only bucket configuration permissions.
   */
  async assertReady(): Promise<void> {
    const [publicAccess, versioning, encryption] = await Promise.all([
      this.client.send(new GetPublicAccessBlockCommand({ Bucket: config.AWS_S3_BUCKET })),
      this.client.send(new GetBucketVersioningCommand({ Bucket: config.AWS_S3_BUCKET })),
      this.client.send(new GetBucketEncryptionCommand({ Bucket: config.AWS_S3_BUCKET })),
    ]);
    const controls = publicAccess.PublicAccessBlockConfiguration;
    if (
      !controls?.BlockPublicAcls ||
      !controls.IgnorePublicAcls ||
      !controls.BlockPublicPolicy ||
      !controls.RestrictPublicBuckets
    ) {
      throw new Error("S3 evidence bucket must enable every Block Public Access control");
    }
    if (versioning.Status !== "Enabled") {
      throw new Error("S3 evidence bucket must have versioning enabled");
    }
    if (!encryption.ServerSideEncryptionConfiguration?.Rules?.length) {
      throw new Error("S3 evidence bucket must have default server-side encryption enabled");
    }
  }

  async createUploadTarget(input: {
    bucket: string;
    key: string;
    mimeType: string;
    checksumSha256Base64: string;
    maxUploadBytes: number;
  }): Promise<MediaUploadTarget> {
    return createPresignedPost(this.client, {
      Bucket: input.bucket,
      Key: input.key,
      Expires: config.AWS_S3_PRESIGNED_URL_EXPIRY_SECONDS,
      Fields: {
        "Content-Type": input.mimeType,
        "Content-Disposition": "attachment",
        "x-amz-checksum-sha256": input.checksumSha256Base64,
        "x-amz-server-side-encryption": "AES256",
        "x-amz-tagging": "networkpeer-evidence-state=pending",
      },
      Conditions: [
        ["eq", "$Content-Type", input.mimeType],
        ["eq", "$Content-Disposition", "attachment"],
        ["eq", "$x-amz-checksum-sha256", input.checksumSha256Base64],
        ["eq", "$x-amz-server-side-encryption", "AES256"],
        ["eq", "$x-amz-tagging", "networkpeer-evidence-state=pending"],
        ["content-length-range", 1, input.maxUploadBytes],
      ],
    });
  }

  async headObject(input: { bucket: string; key: string; versionId?: string }): Promise<StoredMediaObject> {
    const object = await this.client.send(
      new HeadObjectCommand({
        Bucket: input.bucket,
        Key: input.key,
        VersionId: input.versionId,
        ChecksumMode: "ENABLED",
      }),
    );
    return {
      contentLength: object.ContentLength ?? null,
      contentType: object.ContentType ?? null,
      checksumSha256Base64: object.ChecksumSHA256 ?? null,
      etag: object.ETag ?? null,
      versionId: object.VersionId ?? null,
    };
  }

  async setObjectState(input: {
    bucket: string;
    key: string;
    versionId: string;
    state: "pending" | "confirmed";
  }): Promise<void> {
    await this.client.send(
      new PutObjectTaggingCommand({
        Bucket: input.bucket,
        Key: input.key,
        VersionId: input.versionId,
        Tagging: {
          TagSet: [{ Key: "networkpeer-evidence-state", Value: input.state }],
        },
      }),
    );
  }

  async createDownloadUrl(input: {
    bucket: string;
    key: string;
    versionId?: string;
    expiresInSeconds?: number;
  }): Promise<string> {
    const expiresInSeconds = input.expiresInSeconds ?? config.AWS_S3_PRESIGNED_URL_EXPIRY_SECONDS;
    return getSignedUrl(
      this.client,
      new GetObjectCommand({
        Bucket: input.bucket,
        Key: input.key,
        VersionId: input.versionId,
        ResponseContentDisposition: "attachment",
      }),
      { expiresIn: expiresInSeconds },
    );
  }

  async getObjectBytes(input: {
    bucket: string;
    key: string;
    versionId?: string;
  }): Promise<Buffer> {
    const object = await this.client.send(
      new GetObjectCommand({
        Bucket: input.bucket,
        Key: input.key,
        VersionId: input.versionId,
      }),
    );
    if (!object.Body) throw new Error("S3 object body is missing");
    return Buffer.from(await object.Body.transformToByteArray());
  }
}

export const mediaStorage = new S3MediaStorage();
