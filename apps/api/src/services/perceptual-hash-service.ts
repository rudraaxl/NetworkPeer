import sharp from "sharp";
import { config } from "../config.js";

/**
 * Perceptual hashing for duplicate evidence detection. The hash collapses an
 * image to a small grayscale fingerprint so near-duplicate captures can be
 * flagged across jobs/workers without comparing full media bytes.
 */

const PHASH_SIZE = 32;

export type PerceptualHashResult = {
  hash: string;
  bits: number;
};

function hammingDistance(left: string, right: string): number {
  if (left.length !== right.length) return Number.MAX_SAFE_INTEGER;
  let distance = 0;
  for (let i = 0; i < left.length; i += 1) {
    if (left[i] !== right[i]) distance += 1;
  }
  return distance;
}

function bitsToHex(bits: number[]): string {
  let hex = "";
  for (let i = 0; i < bits.length; i += 8) {
    let byte = 0;
    for (let bit = 0; bit < 8 && i + bit < bits.length; bit += 1) {
      const value = bits[i + bit];
      byte = (byte << 1) | (value !== undefined && value !== 0 ? 1 : 0);
    }
    hex += byte.toString(16).padStart(2, "0");
  }
  return hex;
}

/**
 * Compute a perceptual hash from image bytes. Input is a Buffer because the
 * media worker reads the pinned S3 version directly (no public URL).
 */
export async function computePerceptualHash(buffer: Buffer): Promise<PerceptualHashResult> {
  const { data, info } = await sharp(buffer)
    .rotate()
    .resize(PHASH_SIZE, PHASH_SIZE, { fit: "fill" })
    .grayscale()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const pixels = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  const pixelCount = info.width * info.height;
  const total = pixels.reduce((sum, value) => sum + value, 0);
  const average = total / pixelCount;

  const bits: number[] = [];
  for (let i = 0; i < pixelCount; i += 1) {
    const value = pixels[i];
    bits.push(value !== undefined && value >= average ? 1 : 0);
  }

  return { hash: bitsToHex(bits), bits: PHASH_SIZE * PHASH_SIZE };
}

/**
 * Returns true when two perceptual hashes are similar enough to flag as
 * duplicate. The default threshold is tuned for identical/near-identical
 * captures; it should be tightened before automatic rejection.
 */
export function isPerceptualDuplicate(left: string, right: string, threshold = 12): boolean {
  if (!left || !right) return false;
  return hammingDistance(left, right) <= threshold;
}

export function perceptualHashEnabled(): boolean {
  return config.BACKGROUND_QUEUES_ENABLED === "true";
}
