import pg from "pg";
import { config } from "../src/config.js";

/**
 * Phase 1 verification harness.
 * Runs against a real PostgreSQL+PostGIS instance and validates:
 *  1. PostGIS extension + enum types + core tables exist
 *  2. Job creation with a geometry point (PostGIS)
 *  3. Core role and money constraints reject invalid writes
 *  4. Atomic accept_job: single accept succeeds, double accept rejects (55000)
 *  5. Concurrent accept: one job has one winner, one worker has one active claim
 *  6. Worker verification is required before a job can be claimed
 *
 * Idempotent: any seed rows left behind by a previous run are cleaned up
 * before seeding again, so the script is safe to re-run.
 *
 * Usage:
 *   DATABASE_URL=postgresql://... npm run migrate
 *   DATABASE_URL=postgresql://... npx tsx scripts/verify-phase1.ts
 */

const client = new pg.Client({ connectionString: config.DATABASE_URL });

const SEED_PHONES = [
  "+10000000001",
  "+10000000002",
  "+10000000003",
  "+10000000004",
  "+10000000005",
];

function step(name: string): void {
  // eslint-disable-next-line no-console
  console.log(`\n== ${name} ===`);
}

async function check(name: string, fn: () => Promise<void>): Promise<void> {
  try {
    await fn();
    // eslint-disable-next-line no-console
    console.log(`  PASS  ${name}`);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(`  FAIL  ${name}`);
    throw err;
  }
}

/** Remove residue from any previous run. Jobs reference users with RESTRICT, so jobs must go first. */
async function cleanup(): Promise<void> {
  const res = await client.query(`SELECT id FROM users WHERE phone_number = ANY($1)`, [SEED_PHONES]);
  const ids: string[] = res.rows.map((r) => r.id);

  if (ids.length > 0) {
    await client.query(
      `DELETE FROM jobs WHERE client_id = ANY($1::uuid[]) OR worker_id = ANY($1::uuid[])`,
      [ids],
    );
    await client.query(`DELETE FROM users WHERE id = ANY($1::uuid[])`, [ids]);
  }
}

async function main(): Promise<void> {
  await client.connect();
  try {
  await cleanup();

  step("1. Schema sanity");
  await check("PostGIS extension present", async () => {
    const { rows } = await client.query(`SELECT postgis_version() AS v`);
    if (!rows[0]?.v) throw new Error("postgis_version() empty");
  });

  const enums = ["user_role", "job_status", "media_status", "transaction_type", "subtask_status", "transaction_status"];
  for (const e of enums) {
    await check(`enum type ${e} exists`, async () => {
      const { rows } = await client.query(`SELECT 1 FROM pg_type WHERE typname = $1`, [e]);
      if (rows.length === 0) throw new Error(`enum ${e} missing`);
    });
  }

  const tables = ["users", "worker_profiles", "jobs", "job_subtasks", "job_subtask_media", "wallet_ledger"];
  for (const t of tables) {
    await check(`table ${t} exists`, async () => {
      const { rows } = await client.query(
        `SELECT 1 FROM information_schema.tables WHERE table_name = $1`,
        [t],
      );
      if (rows.length === 0) throw new Error(`table ${t} missing`);
    });
  }

  await check("jobs has a PostGIS geometry Point column with SRID 4326", async () => {
    const { rows } = await client.query(
      `
        SELECT
          t.typname,
          postgis_typmod_type(a.atttypmod) AS geometry_type,
          postgis_typmod_srid(a.atttypmod) AS srid
        FROM pg_attribute a
        JOIN pg_class c ON c.oid = a.attrelid
        JOIN pg_type t ON t.oid = a.atttypid
        WHERE c.relname = 'jobs'
          AND a.attname = 'location'
          AND a.attnum > 0
          AND NOT a.attisdropped
      `,
    );
    if (!rows[0] || rows[0].typname !== "geometry") throw new Error("location column is not geometry");
    if (rows[0].geometry_type !== "Point") throw new Error("location column is not Point geometry");
    if (Number(rows[0].srid) !== 4326) throw new Error("location column SRID is not 4326");
  });

  step("Seed users + job");
  const clientRes = await client.query(
    `INSERT INTO users (phone_number, full_name, role) VALUES ($1, 'Test Client', 'CLIENT') RETURNING id`,
    [SEED_PHONES[0]],
  );
  const clientId = clientRes.rows[0].id;

  const workerA = await client.query(
    `INSERT INTO users (phone_number, full_name, role) VALUES ($1, 'Worker A', 'WORKER') RETURNING id`,
    [SEED_PHONES[1]],
  );
  const workerB = await client.query(
    `INSERT INTO users (phone_number, full_name, role) VALUES ($1, 'Worker B', 'WORKER') RETURNING id`,
    [SEED_PHONES[2]],
  );
  const workerC = await client.query(
    `INSERT INTO users (phone_number, full_name, role) VALUES ($1, 'Worker C', 'WORKER') RETURNING id`,
    [SEED_PHONES[3]],
  );
  const workerD = await client.query(
    `INSERT INTO users (phone_number, full_name, role) VALUES ($1, 'Worker D', 'WORKER') RETURNING id`,
    [SEED_PHONES[4]],
  );

  await client.query(
    `INSERT INTO worker_profiles (
       user_id, is_available, verification_status, current_location, last_location_update
     )
     VALUES
       ($1, TRUE, 'VERIFIED', ST_SetSRID(ST_MakePoint(-73.9857, 40.7484), 4326), NOW()),
       ($2, TRUE, 'VERIFIED', ST_SetSRID(ST_MakePoint(-73.9857, 40.7484), 4326), NOW()),
       ($3, TRUE, 'VERIFIED', ST_SetSRID(ST_MakePoint(-73.9857, 40.7484), 4326), NOW()),
       ($4, TRUE, 'VERIFIED', ST_SetSRID(ST_MakePoint(-73.9857, 40.7484), 4326), NOW())`,
    [workerA.rows[0].id, workerB.rows[0].id, workerC.rows[0].id, workerD.rows[0].id],
  );

  const jobRes = await client.query(
    `INSERT INTO jobs (client_id, title, description, category, budget_cents, location, escrow_status)
     VALUES ($1, 'Clean office', 'Deep clean the HQ', 'CLEANING', 15000,
             ST_SetSRID(ST_MakePoint(-73.9857, 40.7484), 4326), 'HELD')
     RETURNING id, ST_AsGeoJSON(location) AS geo`,
    [clientId],
  );
  const jobId = jobRes.rows[0].id;
  const subtask = await client.query(
    `INSERT INTO job_subtasks (job_id, title, sequence_order) VALUES ($1, 'Evidence task', 0) RETURNING id`,
    [jobId],
  );

  await check("a job cannot contain duplicate subtask sequence positions", async () => {
    try {
      await client.query(
        `INSERT INTO job_subtasks (job_id, title, sequence_order) VALUES ($1, 'Duplicate position', 0)`,
        [jobId],
      );
      throw new Error("expected duplicate subtask sequence to be rejected");
    } catch (err) {
      if ((err as pg.DatabaseError).code !== "23505") throw err;
    }
  });

  await check("spatial point round-trips via ST_AsGeoJSON", async () => {
    const geo = JSON.parse(jobRes.rows[0].geo);
    if (geo.type !== "Point") throw new Error("not a point");
    if (geo.coordinates.length !== 2) throw new Error("invalid coordinates");
  });

  step("Core constraints");
  await check("worker profile rejects non-WORKER users", async () => {
    try {
      await client.query(`INSERT INTO worker_profiles (user_id) VALUES ($1)`, [clientId]);
      throw new Error("expected role invariant to reject client worker_profile");
    } catch (err) {
      if ((err as pg.DatabaseError).code !== "23514") throw err;
    }
  });

  await check("job rejects negative budgets", async () => {
    try {
      await client.query(
        `INSERT INTO jobs (client_id, title, description, category, budget_cents, location)
         VALUES ($1, 'Bad budget', 'Should fail', 'TASK', -1,
                 ST_SetSRID(ST_MakePoint(-73.9857, 40.7484), 4326))`,
        [clientId],
      );
      throw new Error("expected budget constraint to reject negative budget");
    } catch (err) {
      if ((err as pg.DatabaseError).code !== "23514") throw err;
    }
  });

  await check("job rejects platform fees greater than the budget", async () => {
    try {
      await client.query(
        `INSERT INTO jobs (client_id, title, description, category, budget_cents, platform_fee_cents, location)
         VALUES ($1, 'Bad fee', 'Platform fee must not exceed budget', 'TASK', 5000, 5001,
                 ST_SetSRID(ST_MakePoint(-73.9857, 40.7484), 4326))`,
        [clientId],
      );
      throw new Error("expected fee constraint to reject the write");
    } catch (err) {
      if ((err as pg.DatabaseError).code !== "23514") throw err;
    }
  });

  await check("job rejects geometry outside WGS84 coordinate bounds", async () => {
    try {
      await client.query(
        `INSERT INTO jobs (client_id, title, description, category, budget_cents, location)
         VALUES ($1, 'Bad geometry', 'Longitude outside WGS84 bounds', 'TASK', 5000,
                 ST_SetSRID(ST_MakePoint(181, 40.7484), 4326))`,
        [clientId],
      );
      throw new Error("expected WGS84 constraint to reject the write");
    } catch (err) {
      if ((err as pg.DatabaseError).code !== "23514") throw err;
    }
  });

  await check("job rejects empty PostGIS points", async () => {
    try {
      await client.query(
        `INSERT INTO jobs (client_id, title, description, category, budget_cents, location)
         VALUES ($1, 'Empty point', 'Should fail', 'TASK', 5000, ST_GeomFromText('POINT EMPTY', 4326))`,
        [clientId],
      );
      throw new Error("expected empty geometry to be rejected");
    } catch (err) {
      if ((err as pg.DatabaseError).code !== "23514") throw err;
    }
  });

  await check("job rejects a WORKER as client_id", async () => {
    try {
      await client.query(
        `INSERT INTO jobs (client_id, title, description, category, budget_cents, location)
         VALUES ($1, 'Bad role', 'Should fail', 'TASK', 5000,
                 ST_SetSRID(ST_MakePoint(-73.9857, 40.7484), 4326))`,
        [workerB.rows[0].id],
      );
      throw new Error("expected role invariant to reject worker client_id");
    } catch (err) {
      if ((err as pg.DatabaseError).code !== "23514") throw err;
    }
  });

  step("Atomic accept_job");
  await check("worker accepts a POSTED job -> ASSIGNED", async () => {
    const { rows } = await client.query(`SELECT * FROM accept_job($1, $2)`, [jobId, workerA.rows[0].id]);
    if (rows[0].status !== "ASSIGNED") throw new Error(`expected ASSIGNED, got ${rows[0].status}`);
  });

  await check("second accept on same job rejects (55000)", async () => {
    try {
      await client.query(`SELECT * FROM accept_job($1, $2)`, [jobId, workerB.rows[0].id]);
      throw new Error("expected reject but accept_job succeeded");
    } catch (err) {
      if ((err as pg.DatabaseError).code !== "55000") throw err;
    }
  });

  await check("invalid worker rejects (22000)", async () => {
    try {
      await client.query(`SELECT * FROM accept_job($1, '00000000-0000-0000-0000-000000000000')`, [jobId]);
      throw new Error("expected reject but accept_job succeeded");
    } catch (err) {
      if ((err as pg.DatabaseError).code !== "22000") throw err;
    }
  });

  await check("unverified workers cannot claim jobs", async () => {
    await client.query(
      `UPDATE worker_profiles
       SET verification_status = 'PENDING', is_available = FALSE
       WHERE user_id = $1`,
      [workerB.rows[0].id],
    );
    try {
      await client.query(`SELECT * FROM accept_job($1, $2)`, [jobId, workerB.rows[0].id]);
      throw new Error("expected unverified worker to be rejected");
    } catch (err) {
      if ((err as pg.DatabaseError).code !== "22000") throw err;
    } finally {
      await client.query(
        `UPDATE worker_profiles
         SET verification_status = 'VERIFIED', is_available = TRUE
         WHERE user_id = $1`,
        [workerB.rows[0].id],
      );
    }
  });

  step("Cross-record integrity constraints");
  await check("assigned lifecycle states require a worker", async () => {
    try {
      await client.query(
        `INSERT INTO jobs (client_id, title, description, category, status, budget_cents, location)
         VALUES ($1, 'Invalid assigned job', 'An assigned job must have a worker', 'TASK', 'ASSIGNED', 5000,
                 ST_SetSRID(ST_MakePoint(-73.98, 40.74), 4326))`,
        [clientId],
      );
      throw new Error("expected assigned job without worker to be rejected");
    } catch (err) {
      if ((err as pg.DatabaseError).code !== "23514") throw err;
    }
  });

  await check("database rejects lifecycle jumps that bypass the state machine", async () => {
    try {
      await client.query(`UPDATE jobs SET status = 'COMPLETED' WHERE id = $1`, [jobId]);
      throw new Error("expected invalid state transition to be rejected");
    } catch (err) {
      if ((err as pg.DatabaseError).code !== "23514") throw err;
    }
  });

  await check("user roles cannot be changed after account creation", async () => {
    try {
      await client.query(`UPDATE users SET role = 'WORKER' WHERE id = $1`, [clientId]);
      throw new Error("expected immutable role constraint to reject role change");
    } catch (err) {
      if ((err as pg.DatabaseError).code !== "23514") throw err;
    }
  });

  await check("job evidence rejects a worker not assigned to that job", async () => {
    try {
      await client.query(
        `INSERT INTO job_subtask_media (subtask_id, job_id, worker_id, s3_key, s3_bucket, media_type, captured_at)
         VALUES ($1, $2, $3, 'evidence.jpg', 'verification', 'IMAGE', NOW())`,
        [subtask.rows[0].id, jobId, workerB.rows[0].id],
      );
      throw new Error("expected evidence worker invariant to reject the write");
    } catch (err) {
      if ((err as pg.DatabaseError).code !== "23514") throw err;
    }
  });

  step("Concurrency (one worker racing for two jobs)");
  const sameWorkerJobA = await client.query(
    `INSERT INTO jobs (client_id, title, description, category, budget_cents, location, escrow_status)
     VALUES ($1, 'Same worker A', 'Only one active claim should win', 'TASK', 5000,
             ST_SetSRID(ST_MakePoint(-73.98, 40.74), 4326), 'HELD')
     RETURNING id`,
    [clientId],
  );
  const sameWorkerJobB = await client.query(
    `INSERT INTO jobs (client_id, title, description, category, budget_cents, location, escrow_status)
     VALUES ($1, 'Same worker B', 'Same worker second claim should fail', 'TASK', 5000,
             ST_SetSRID(ST_MakePoint(-73.981, 40.741), 4326), 'HELD')
     RETURNING id`,
    [clientId],
  );

  const sameWorkerClientA = new pg.Client({ connectionString: config.DATABASE_URL });
  const sameWorkerClientB = new pg.Client({ connectionString: config.DATABASE_URL });
  await Promise.all([sameWorkerClientA.connect(), sameWorkerClientB.connect()]);

  const sameWorkerOutcomes = await Promise.allSettled([
    sameWorkerClientA.query(`SELECT * FROM accept_job($1, $2)`, [sameWorkerJobA.rows[0].id, workerB.rows[0].id]),
    sameWorkerClientB.query(`SELECT * FROM accept_job($1, $2)`, [sameWorkerJobB.rows[0].id, workerB.rows[0].id]),
  ]);

  await sameWorkerClientA.end();
  await sameWorkerClientB.end();

  const sameWorkerSucceeded = sameWorkerOutcomes.filter((o) => o.status === "fulfilled");
  const sameWorkerRejected = sameWorkerOutcomes.filter(
    (o) =>
      o.status === "rejected" &&
      ["22000", "55000"].includes((o.reason as pg.DatabaseError).code ?? ""),
  );

  if (sameWorkerSucceeded.length !== 1 || sameWorkerRejected.length !== 1) {
    // eslint-disable-next-line no-console
    console.error("  same-worker outcomes:", sameWorkerOutcomes.map((o) => (o.status === "fulfilled" ? o.value.rows : o.reason)));
    throw new Error(`expected same worker to claim exactly 1 job, got ${sameWorkerSucceeded.length}/${sameWorkerRejected.length}`);
  }
  // eslint-disable-next-line no-console
  console.log("        PASS  same worker concurrent accept: exactly one active claim succeeded");

  step("Concurrency (two independent workers racing for one job)");
  const raceJob = await client.query(
    `INSERT INTO jobs (client_id, title, description, category, budget_cents, location, escrow_status)
     VALUES ($1, 'Race job', 'First to accept wins', 'TASK', 5000,
             ST_SetSRID(ST_MakePoint(-73.99, 40.75), 4326), 'HELD')
     RETURNING id`,
    [clientId],
  );
  const raceJobId = raceJob.rows[0].id;

  const winnerA = new pg.Client({ connectionString: config.DATABASE_URL });
  const winnerB = new pg.Client({ connectionString: config.DATABASE_URL });
  await Promise.all([winnerA.connect(), winnerB.connect()]);

  const outcomes = await Promise.allSettled([
    winnerA.query(`SELECT * FROM accept_job($1, $2)`, [raceJobId, workerC.rows[0].id]),
    winnerB.query(`SELECT * FROM accept_job($1, $2)`, [raceJobId, workerD.rows[0].id]),
  ]);

  await winnerA.end();
  await winnerB.end();

  const succeeded = outcomes.filter((o) => o.status === "fulfilled");
  const rejected = outcomes.filter(
    (o) => o.status === "rejected" && (o.reason as pg.DatabaseError).code === "55000",
  );

  if (succeeded.length !== 1 || rejected.length !== 1) {
    // eslint-disable-next-line no-console
    console.error("  race outcomes:", outcomes.map((o) => (o.status === "fulfilled" ? o.value.rows : o.reason)));
    throw new Error(`expected exactly 1 winner and 1 rejection, got ${succeeded.length}/${rejected.length}`);
  }
  // eslint-disable-next-line no-console
  console.log("        PASS  concurrent accept: exactly one worker claimed the job, the other got 55000");

  // eslint-disable-next-line no-console
  console.log("\nPhase 1 verification complete: all checks passed.");
  } finally {
    await cleanup();
    await client.end();
  }
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error("\nPhase 1 verification FAILED:", err);
  process.exit(1);
});
