import * as FileSystem from "expo-file-system/legacy";

const K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

const H0 = new Uint32Array([
  0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
]);

function rotr(x: number, n: number): number {
  return (x >>> n) | (x << (32 - n));
}

function hashBlock(h: Uint32Array, block: Uint8Array): void {
  const w = new Uint32Array(64);
  for (let i = 0; i < 16; i++) {
    w[i] =
      (block[i * 4] << 24) | (block[i * 4 + 1] << 16) | (block[i * 4 + 2] << 8) | block[i * 4 + 3];
  }
  for (let i = 16; i < 64; i++) {
    const s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3);
    const s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10);
    w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
  }

  let a = h[0], b = h[1], c = h[2], d = h[3];
  let e = h[4], f = h[5], g = h[6], hh = h[7];

  for (let i = 0; i < 64; i++) {
    const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
    const ch = (e & f) ^ (~e & g);
    const temp1 = (hh + S1 + ch + K[i] + w[i]) >>> 0;
    const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
    const maj = (a & b) ^ (a & c) ^ (b & c);
    const temp2 = (S0 + maj) >>> 0;
    hh = g; g = f; f = e;
    e = (d + temp1) >>> 0;
    d = c; c = b; b = a;
    a = (temp1 + temp2) >>> 0;
  }

  h[0] += a; h[1] += b; h[2] += c; h[3] += d;
  h[4] += e; h[5] += f; h[6] += g; h[7] += hh;
}

function toBytes(value: number): number {
  return value >>> 0;
}

export function sha256Base64ToHex(base64: string): string {
  const h = new Uint32Array(H0);
  const block = new Uint8Array(64);
  let blockLen = 0;
  let totalBytes = 0;

  const consume = (byte: number) => {
    block[blockLen++] = byte;
    if (blockLen === 64) {
      hashBlock(h, block);
      block.fill(0);
      blockLen = 0;
    }
  };

  let acc = 0;
  let accBits = 0;
  for (let i = 0; i < base64.length; i++) {
    const code = base64.charCodeAt(i);
    if (code === 61) break; // '='
    let v = -1;
    if (code >= 65 && code <= 90) v = code - 65;
    else if (code >= 97 && code <= 122) v = code - 71;
    else if (code >= 48 && code <= 57) v = code + 4;
    else if (code === 43) v = 62;
    else if (code === 47) v = 63;
    if (v < 0) continue;
    acc = (acc << 6) | v;
    accBits += 6;
    if (accBits >= 8) {
      accBits -= 8;
      consume(toBytes(acc >>> accBits));
      totalBytes++;
    }
  }

  block[blockLen++] = 0x80;
  if (blockLen > 56) {
    block.fill(0, blockLen);
    hashBlock(h, block);
    block.fill(0);
  } else {
    block.fill(0, blockLen);
  }
  const bits = totalBytes * 8;
  block[60] = (bits >>> 24) & 0xff;
  block[61] = (bits >>> 16) & 0xff;
  block[62] = (bits >>> 8) & 0xff;
  block[63] = bits & 0xff;
  hashBlock(h, block);

  let hex = "";
  for (let i = 0; i < 8; i++) {
    hex += h[i].toString(16).padStart(8, "0");
  }
  return hex;
}

export async function sha256HexOfFile(uri: string): Promise<string> {
  const base64 = await FileSystem.readAsStringAsync(uri, {
    encoding: FileSystem.EncodingType.Base64,
  });
  return sha256Base64ToHex(base64);
}