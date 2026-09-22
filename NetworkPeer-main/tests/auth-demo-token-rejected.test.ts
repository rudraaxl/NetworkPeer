import { describe, expect, it } from "vitest";
import { verifyAccessToken, AuthError } from "../src/auth.js";

/**
 * NP-03 regression guard.
 *
 * `verifyAccessToken` used to short-circuit on any bearer token beginning with
 * "demo-" and return a fully populated principal, choosing the role from
 * substrings of the attacker-supplied string. "demo-admin" was therefore a
 * valid administrator credential against every deployment. These tests fail if
 * that branch -- or anything shaped like it -- is reintroduced.
 */
describe("NP-03: demo- bearer tokens are not credentials", () => {
  const forgedTokens = [
    "demo-admin",
    "demo-worker",
    "demo-client",
    "demo-",
    "demo-ADMIN-anything",
    "demo-admin.with.dots",
  ];

  for (const token of forgedTokens) {
    it(`rejects ${JSON.stringify(token)}`, async () => {
      await expect(verifyAccessToken(token)).rejects.toBeInstanceOf(AuthError);
    });
  }

  it("never mints an ADMIN principal from an unsigned string", async () => {
    // Belt and braces: assert on the outcome rather than the error type, so a
    // future refactor that returns claims instead of throwing still fails here.
    for (const token of forgedTokens) {
      let claims: unknown = null;
      try {
        claims = await verifyAccessToken(token);
      } catch {
        continue;
      }
      expect.unreachable(`verifyAccessToken resolved for forged token ${token}: ${JSON.stringify(claims)}`);
    }
  });
});
