/**
 * Grants ADMIN to an existing account (NP-12).
 *
 * This is the only supported way to create an administrator. It is deliberately
 * an operator action rather than an API surface: there is no request a client
 * can make that changes a role, so an attacker who reaches the API cannot reach
 * this. Run it with the same DATABASE_URL the API uses.
 *
 *   npm run grant-admin -- someone@example.com
 *
 * The account must already exist, be active and be verified -- sign in once
 * through the normal email OTP flow first. Running it twice is a no-op.
 */
import pg from "pg";
import { config } from "../src/config.js";

async function main(): Promise<void> {
  const email = process.argv[2]?.trim();
  if (!email) {
    // eslint-disable-next-line no-console -- operator CLI
    console.error("Usage: npm run grant-admin -- <email>");
    process.exit(2);
  }

  const grantedBy = process.env["GRANTED_BY"] || `cli:${process.env["USER"] || "unknown"}`;
  const client = new pg.Client({ connectionString: config.DATABASE_ADMIN_URL });
  await client.connect();

  try {
    const { rows } = await client.query<{ grant_admin_by_email: string }>(
      `SELECT public.grant_admin_by_email($1, $2)`,
      [email, grantedBy],
    );
    const userId = rows[0]?.grant_admin_by_email;
    // eslint-disable-next-line no-console -- operator CLI
    console.log(`Granted ADMIN to ${email} (user ${userId}), attributed to ${grantedBy}.`);
  } finally {
    await client.end();
  }
}

main().catch((err: unknown) => {
  // eslint-disable-next-line no-console -- operator CLI
  console.error(`Failed to grant ADMIN: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
