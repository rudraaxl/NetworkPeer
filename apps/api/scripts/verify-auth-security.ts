import pg from "pg";
import {
  AuthError,
  issueTokenPair,
  rotateRefreshToken,
  signAccessToken,
  type RefreshTokenClaims,
  type TokenPair,
} from "../src/auth.js";
import { closeConnections, redis } from "../src/db.js";
import { config } from "../src/config.js";

const client = new pg.Client({ connectionString: config.DATABASE_URL });
// Keep this seed distinct from all phase verifier phone ranges so their
// dependency cleanup cannot delete each other's users or jobs.
const PHONE = "+10000000999";

function refreshClaims(token: string): RefreshTokenClaims {
  const payload = token.split(".")[1];
  if (!payload) throw new Error("Refresh token payload missing");
  return JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as RefreshTokenClaims;
}

function assert(condition: unknown, name: string): void {
  if (!condition) throw new Error(`Auth security assertion failed: ${name}`);
  // eslint-disable-next-line no-console
  console.log(`  PASS  ${name}`);
}

function isFulfilled(result: PromiseSettledResult<TokenPair>): result is PromiseFulfilledResult<TokenPair> {
  return result.status === "fulfilled";
}

function isReusedFailure(result: PromiseSettledResult<TokenPair>): boolean {
  return result.status === "rejected" && result.reason instanceof AuthError && result.reason.code === "TOKEN_REUSED";
}

async function main(): Promise<void> {
  let family: string | null = null;
  const refreshJtis = new Set<string>();
  await client.connect();

  try {
    await client.query(`DELETE FROM users WHERE phone_number = $1`, [PHONE]);
    const created = await client.query<{ id: string }>(
      `
        INSERT INTO users (phone_number, full_name, role, is_verified)
        VALUES ($1, 'Auth Security Verifier', 'CLIENT', TRUE)
        RETURNING id
      `,
      [PHONE],
    );
    const userId = created.rows[0]?.id;
    if (!userId) throw new Error("Could not create auth verification user");

    // eslint-disable-next-line no-console
    console.log("\n== Auth rotation security verification ==");
    const first = await issueTokenPair({ id: userId, role: "CLIENT", phone: PHONE }, signAccessToken);
    const firstClaims = refreshClaims(first.refresh_token);
    family = firstClaims.family;
    refreshJtis.add(firstClaims.jti);

    const second = await rotateRefreshToken(first.refresh_token, signAccessToken);
    const secondClaims = refreshClaims(second.refresh_token);
    refreshJtis.add(secondClaims.jti);
    const membersAfterRotation = await redis.smembers(`refresh:family:${family}`);
    assert(
      membersAfterRotation.length === 1 && membersAfterRotation[0] === secondClaims.jti,
      "successful rotation removes stale family members",
    );

    const concurrent = await Promise.allSettled([
      rotateRefreshToken(second.refresh_token, signAccessToken),
      rotateRefreshToken(second.refresh_token, signAccessToken),
    ]);
    const successful = concurrent.filter(isFulfilled);
    assert(successful.length === 1, "exactly one concurrent refresh rotation succeeds");
    assert(concurrent.filter(isReusedFailure).length === 1, "refresh replay is detected as TOKEN_REUSED");

    const thirdClaims = refreshClaims(successful[0]!.value.refresh_token);
    refreshJtis.add(thirdClaims.jti);
    try {
      await rotateRefreshToken(successful[0]!.value.refresh_token, signAccessToken);
      throw new Error("Expected replay-revoked refresh token to fail");
    } catch (err) {
      assert(err instanceof AuthError && err.code === "TOKEN_REUSED", "replay revokes the entire token family");
    }

    assert(
      (await redis.smembers(`refresh:family:${family}`)).length === 0,
      "family set and active sessions are removed after replay detection",
    );
    // eslint-disable-next-line no-console
    console.log("\nAuth rotation security verification complete: all checks passed.");
  } finally {
    if (family) {
      await redis.del(`refresh:family:${family}`);
    }
    if (refreshJtis.size > 0) {
      await redis.del(...[...refreshJtis].map((jti) => `refresh:${jti}`));
    }
    await client.query(`DELETE FROM users WHERE phone_number = $1`, [PHONE]);
    await client.end();
    await closeConnections();
  }
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error("\nAuth rotation security verification FAILED:", err);
  process.exit(1);
});
