import { randomUUID } from "node:crypto";
import { buildApp } from "../src/index.js";
import { closeConnections, pool, redis } from "../src/db.js";
import { signAccessToken } from "../src/auth.js";
import { config } from "../src/config.js";
import { signPaymentWebhook } from "../src/services/payment-gateway-service.js";

type SeedUser = { id: string; phone: string; role: "CLIENT" | "WORKER" };

function assert(condition: unknown, name: string): asserts condition {
  if (!condition) throw new Error(`Phase 8 assertion failed: ${name}`);
  // eslint-disable-next-line no-console
  console.log(`  PASS  ${name}`);
}

function bearer(token: string) {
  return { authorization: `Bearer ${token}` };
}

function webhookPayload(id: string, type: string, providerReference: string, operationId: string) {
  return JSON.stringify({
    id,
    type,
    data: { object: { id: providerReference, metadata: { networkpeer_operation_id: operationId } } },
  });
}

async function createUsers(seed: string): Promise<{ client: SeedUser; worker: SeedUser }> {
  const clientPhone = `+1555${seed.slice(0, 7)}`.replace(/[^\d+]/g, "").slice(0, 15);
  const workerPhone = `+1666${seed.slice(0, 7)}`.replace(/[^\d+]/g, "").slice(0, 15);
  const { rows } = await pool.query<SeedUser>(
    `
      INSERT INTO users (phone_number, full_name, role, is_active, is_verified)
      VALUES ($1, 'Phase 8 Client', 'CLIENT', TRUE, TRUE),
             ($2, 'Phase 8 Worker', 'WORKER', TRUE, TRUE)
      RETURNING id, phone_number AS phone, role
    `,
    [clientPhone, workerPhone],
  );
  const client = rows.find((row) => row.role === "CLIENT");
  const worker = rows.find((row) => row.role === "WORKER");
  if (!client || !worker) throw new Error("Could not seed Phase 8 users");
  await pool.query(
    `
      INSERT INTO worker_profiles (
        user_id, verification_status, is_available, current_location, last_location_update
      ) VALUES (
        $1, 'VERIFIED', TRUE, ST_SetSRID(ST_MakePoint(77.5946, 12.9716), 4326), NOW()
      )
    `,
    [worker.id],
  );
  return { client, worker };
}

async function deleteSeedData(userIds: string[]): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SET LOCAL networkpeer.maintenance_mode = 'on'");
    await client.query(`DELETE FROM admin_audit_log WHERE actor_user_id = ANY($1::uuid[])`, [userIds]);
    await client.query(`DELETE FROM payment_webhook_events WHERE payment_operation_id IN (SELECT id FROM payment_operations WHERE client_user_id = ANY($1::uuid[]) OR worker_user_id = ANY($1::uuid[]))`, [userIds]);
    await client.query(`DELETE FROM payment_operations WHERE client_user_id = ANY($1::uuid[]) OR worker_user_id = ANY($1::uuid[])`, [userIds]);
    await client.query(`UPDATE jobs SET escrow_ledger_transaction_id = NULL, settlement_ledger_transaction_id = NULL WHERE client_id = ANY($1::uuid[])`, [userIds]);
    await client.query(`UPDATE ledger_transactions SET job_id = NULL WHERE job_id IN (SELECT id FROM jobs WHERE client_id = ANY($1::uuid[]))`, [userIds]);
    await client.query(`DELETE FROM wallet_ledger WHERE user_id = ANY($1::uuid[]) OR job_id IN (SELECT id FROM jobs WHERE client_id = ANY($1::uuid[]))`, [userIds]);
    await client.query(`DELETE FROM ledger_accounts WHERE owner_user_id = ANY($1::uuid[])`, [userIds]);
    await client.query(`DELETE FROM jobs WHERE client_id = ANY($1::uuid[])`, [userIds]);
    await client.query(`DELETE FROM ledger_transactions WHERE job_id IS NULL AND idempotency_key LIKE 'phase8-%'`);
    await client.query(`DELETE FROM worker_profiles WHERE user_id = ANY($1::uuid[])`, [userIds]);
    await client.query(`DELETE FROM users WHERE id = ANY($1::uuid[])`, [userIds]);
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

async function main() {
  // Fastify injection always originates from the loopback address. Clear only
  // that test key so preceding phase verifiers cannot exhaust production-like
  // rate limiting for this independent integration fixture.
  await redis.del("rate:127.0.0.1");
  const seed = randomUUID().replaceAll("-", "");
  const users = await createUsers(seed);
  const userIds = [users.client.id, users.worker.id];
  const clientToken = signAccessToken({ id: users.client.id, role: "CLIENT", phone: users.client.phone });
  const workerToken = signAccessToken({ id: users.worker.id, role: "WORKER", phone: users.worker.phone });
  const app = await buildApp({ realtimeEnabled: false });
  const originalFeeBps = config.PLATFORM_FEE_BPS;

  try {
    // eslint-disable-next-line no-console
    console.log("\n== Phase 8 financial and escrow verification ==");
    let response = await app.inject({
      method: "POST",
      url: "/api/v1/client/jobs",
      headers: bearer(clientToken),
      payload: {
        title: "Funded site inspection",
        description: "Inspect the site and document completion for escrow verification.",
        category: "INSPECTION",
        budget_cents: 10_000,
        currency: "USD",
        location: { latitude: 12.9716, longitude: 77.5946 },
        idempotency_key: "phase8-job-create-key",
      },
    });
    assert(response.statusCode === 201, "client creates an unfunded FUNDING job");
    const created = response.json<{ data: { id: string; status: string; escrow_status: string } }>().data;
    assert(created.status === "FUNDING" && created.escrow_status === "UNFUNDED", "new job is not publicly claimable before escrow");

    response = await app.inject({
      method: "GET",
      url: "/api/v1/worker/jobs/nearby?radius_km=5",
      headers: bearer(workerToken),
    });
    assert(response.statusCode === 200 && !response.json<{ data: { items: { id: string }[] } }>().data.items.some((job) => job.id === created.id), "unfunded job is hidden from worker discovery");

    response = await app.inject({
      method: "POST",
      url: `/api/v1/client/jobs/${created.id}/fund`,
      headers: bearer(clientToken),
      payload: { idempotency_key: "phase8-funding-key" },
    });
    assert(response.statusCode === 202, "client creates an idempotent pending escrow hold");
    const funding = response.json<{ data: { operationId: string; providerReference: string; status: string } }>().data;
    assert(funding.status === "PENDING" && Boolean(funding.providerReference), "gateway funding operation is dispatched without settling locally");

    response = await app.inject({
      method: "POST",
      url: `/api/v1/client/jobs/${created.id}/fund`,
      headers: bearer(clientToken),
      payload: { idempotency_key: "phase8-funding-key" },
    });
    const fundingRetry = response.json<{ data: { operationId: string; providerReference: string } }>().data;
    assert(response.statusCode === 202 && fundingRetry.operationId === funding.operationId && fundingRetry.providerReference === funding.providerReference, "funding retry returns the same payment operation");

    response = await app.inject({
      method: "POST",
      url: `/api/v1/client/jobs/${created.id}/fund`,
      headers: bearer(clientToken),
      payload: { idempotency_key: "phase8-other-funding-key" },
    });
    assert(
      response.statusCode === 409 && response.json<{ error: { code: string } }>().error.code === "FINANCIAL_OPERATION_CONFLICT",
      "a second funding key cannot create a duplicate pending charge",
    );

    const fundingWebhook = webhookPayload(`evt_fund_${seed}`, "payment_intent.succeeded", funding.providerReference, funding.operationId);
    response = await app.inject({
      method: "POST",
      url: "/api/v1/webhooks/payments",
      headers: {
        "content-type": "application/json",
        "stripe-signature": signPaymentWebhook(Buffer.from(fundingWebhook)),
      },
      payload: fundingWebhook,
    });
    assert(response.statusCode === 200 && response.json<{ data: { status: string } }>().data.status === "SUCCEEDED", "signed funding webhook atomically settles escrow");

    const fundedJob = await pool.query<{ status: string; escrow_status: string }>(`SELECT status, escrow_status FROM jobs WHERE id = $1`, [created.id]);
    assert(fundedJob.rows[0]?.status === "POSTED" && fundedJob.rows[0]?.escrow_status === "HELD", "only successful escrow moves the job to POSTED");
    const journals = await pool.query<{ ledger_transaction_id: string; entries: string; total: string }>(
      `
        SELECT ledger_transaction_id::text, COUNT(*)::text AS entries, SUM(amount_cents)::text AS total
        FROM wallet_ledger
        WHERE job_id = $1 AND ledger_transaction_id IS NOT NULL
        GROUP BY ledger_transaction_id
      `,
      [created.id],
    );
    assert(journals.rows.length === 1 && journals.rows[0]?.entries === "2" && journals.rows[0]?.total === "0", "escrow hold is an exactly balanced double-entry journal");

    response = await app.inject({
      method: "POST",
      url: `/api/v1/worker/jobs/${created.id}/accept`,
      headers: bearer(workerToken),
    });
    assert(response.statusCode === 200, "worker can claim only the funded job");
    for (const status of ["EN_ROUTE", "AT_LOCATION", "IN_PROGRESS"] as const) {
      response = await app.inject({
        method: "POST",
        url: "/api/v1/work/status",
        headers: bearer(workerToken),
        payload: { job_id: created.id, status },
      });
      assert(response.statusCode === 200, `worker advances funded job to ${status}`);
    }
    response = await app.inject({ method: "POST", url: "/api/v1/work/submit", headers: bearer(workerToken), payload: { job_id: created.id } });
    assert(response.statusCode === 200, "worker submits completed funded work");

    response = await app.inject({
      method: "POST",
      url: `/api/v1/client/jobs/${created.id}/approve`,
      headers: bearer(clientToken),
      payload: { idempotency_key: "phase8-approval-key" },
    });
    assert(response.statusCode === 200, "client approval atomically releases escrow and creates payout dispatch");
    const approval = response.json<{ data: { status: string; settlementLedgerTransactionId: string; payoutOperationId: string; payoutProviderReference: string; payoutAmountCents: string } }>().data;
    assert(approval.status === "APPROVED" && approval.payoutAmountCents === "9000" && Boolean(approval.payoutProviderReference), "approval subtracts the configured platform fee before payout");

    response = await app.inject({
      method: "POST",
      url: `/api/v1/client/jobs/${created.id}/approve`,
      headers: bearer(clientToken),
      payload: { idempotency_key: "phase8-approval-key" },
    });
    const approvalRetry = response.json<{ data: { settlementLedgerTransactionId: string; payoutOperationId: string; payoutStatus: string; payoutProviderReference: string } }>().data;
    assert(
      response.statusCode === 200 &&
        approvalRetry.settlementLedgerTransactionId === approval.settlementLedgerTransactionId &&
        approvalRetry.payoutOperationId === approval.payoutOperationId &&
        approvalRetry.payoutStatus === "PENDING" &&
        approvalRetry.payoutProviderReference === approval.payoutProviderReference,
      "approval retry reports the original settlement and dispatched payout state",
    );

    const settlementRows = await pool.query<{ ledger_transaction_id: string; entries: string; total: string; transaction_status: string }>(
      `
        SELECT ledger_transaction_id::text, COUNT(*)::text AS entries, SUM(amount_cents)::text AS total, MIN(transaction_status)::text AS transaction_status
        FROM wallet_ledger
        WHERE job_id = $1 AND ledger_transaction_id IS NOT NULL
        GROUP BY ledger_transaction_id
        ORDER BY ledger_transaction_id
      `,
      [created.id],
    );
    assert(settlementRows.rows.length === 3 && settlementRows.rows.every((row) => row.total === "0"), "hold, release, and payout journals all remain balanced");
    assert(settlementRows.rows.some((row) => row.entries === "3" && row.transaction_status === "COMPLETED"), "approval creates completed release, worker payout, and platform fee postings");
    assert(settlementRows.rows.some((row) => row.entries === "2" && row.transaction_status === "PENDING"), "external payout remains pending until its webhook confirms delivery");

    response = await app.inject({ method: "GET", url: "/api/v1/client/wallet", headers: bearer(clientToken) });
    const clientWallet = response.json<{ data: { balances: { pendingEscrowCents: string; lifetimeSpendCents: string }[] } }>().data.balances[0];
    assert(response.statusCode === 200 && clientWallet?.pendingEscrowCents === "0" && clientWallet.lifetimeSpendCents === "10000", "client wallet derives spend and pending escrow from completed postings");
    response = await app.inject({ method: "GET", url: "/api/v1/worker/wallet", headers: bearer(workerToken) });
    const workerWallet = response.json<{ data: { balances: { availableBalanceCents: string; lifetimeEarningsCents: string }[] } }>().data.balances[0];
    assert(response.statusCode === 200 && workerWallet?.availableBalanceCents === "9000" && workerWallet.lifetimeEarningsCents === "9000", "worker wallet exposes payable balance before external payout settles");

    const payoutWebhook = webhookPayload(`evt_payout_${seed}`, "payout.paid", approval.payoutProviderReference, approval.payoutOperationId);
    response = await app.inject({
      method: "POST",
      url: "/api/v1/webhooks/payments",
      headers: { "content-type": "application/json", "stripe-signature": signPaymentWebhook(Buffer.from(payoutWebhook)) },
      payload: payoutWebhook,
    });
    assert(response.statusCode === 200 && response.json<{ data: { status: string } }>().data.status === "SUCCEEDED", "payout webhook settles only its pending journal");
    response = await app.inject({
      method: "POST",
      url: "/api/v1/webhooks/payments",
      headers: { "content-type": "application/json", "stripe-signature": signPaymentWebhook(Buffer.from(payoutWebhook)) },
      payload: payoutWebhook,
    });
    assert(response.statusCode === 200 && response.json<{ data: { duplicate: boolean } }>().data.duplicate, "duplicate webhook is idempotently ignored");

    response = await app.inject({ method: "GET", url: "/api/v1/worker/wallet", headers: bearer(workerToken) });
    const paidWorkerWallet = response.json<{ data: { balances: { availableBalanceCents: string; lifetimeEarningsCents: string }[] } }>().data.balances[0];
    assert(paidWorkerWallet?.availableBalanceCents === "0" && paidWorkerWallet.lifetimeEarningsCents === "9000", "successful payout clears payable balance without rewriting earnings history");

    await pool.query(
      `UPDATE payment_operations SET provider = 'STRIPE', payout_destination_reference = 'acct_phase8_reversal' WHERE id = $1`,
      [approval.payoutOperationId],
    );
    const reversalPayload = (eventId: string, cumulativeAmount: number) => ({
      id: eventId,
      type: "transfer.reversed",
      data: {
        object: {
          id: approval.payoutProviderReference,
          amount_reversed: cumulativeAmount,
          metadata: { networkpeer_operation_id: approval.payoutOperationId },
        },
      },
    });
    let reversal = await pool.query<{ reversed_amount_cents: string; duplicate: boolean }>(
      `SELECT * FROM reconcile_payout_reversal_webhook($1, $2, $3, $4, $5::jsonb)`,
      [
        "STRIPE",
        `evt_reversal_partial_${seed}`,
        approval.payoutProviderReference,
        2_500,
        JSON.stringify(reversalPayload(`evt_reversal_partial_${seed}`, 2_500)),
      ],
    );
    assert(reversal.rows[0]?.reversed_amount_cents === "2500" && !reversal.rows[0]?.duplicate, "partial payout reversal posts only the reversed amount");
    reversal = await pool.query<{ reversed_amount_cents: string; duplicate: boolean }>(
      `SELECT * FROM reconcile_payout_reversal_webhook($1, $2, $3, $4, $5::jsonb)`,
      [
        "STRIPE",
        `evt_reversal_total_${seed}`,
        approval.payoutProviderReference,
        4_000,
        JSON.stringify(reversalPayload(`evt_reversal_total_${seed}`, 4_000)),
      ],
    );
    assert(reversal.rows[0]?.reversed_amount_cents === "4000" && !reversal.rows[0]?.duplicate, "later payout reversal posts only the incremental delta");
    reversal = await pool.query<{ reversed_amount_cents: string; duplicate: boolean }>(
      `SELECT * FROM reconcile_payout_reversal_webhook($1, $2, $3, $4, $5::jsonb)`,
      [
        "STRIPE",
        `evt_reversal_total_${seed}`,
        approval.payoutProviderReference,
        4_000,
        JSON.stringify(reversalPayload(`evt_reversal_total_${seed}`, 4_000)),
      ],
    );
    assert(reversal.rows[0]?.reversed_amount_cents === "4000" && reversal.rows[0]?.duplicate, "duplicate payout reversal cannot create another posting");
    const reversalBalance = await pool.query<{ total: string; entries: string }>(
      `
        SELECT COALESCE(SUM(posting.amount_cents), 0)::text AS total, COUNT(*)::text AS entries
        FROM wallet_ledger posting
        JOIN ledger_transactions transaction ON transaction.id = posting.ledger_transaction_id
        WHERE transaction.idempotency_key LIKE 'payout-reversal:%'
          AND transaction.job_id = $1
      `,
      [created.id],
    );
    assert(reversalBalance.rows[0]?.total === "0" && reversalBalance.rows[0]?.entries === "4", "payout reversal postings remain balanced and immutable");

    await pool.query(`SELECT * FROM resolve_client_job($1, $2, 'COMPLETE')`, [created.id, users.client.id]);
    config.PLATFORM_FEE_BPS = 0;
    response = await app.inject({
      method: "POST",
      url: "/api/v1/client/jobs",
      headers: bearer(clientToken),
      payload: {
        title: "Zero fee inspection",
        description: "A zero platform fee job must settle as a valid double-entry journal.",
        category: "INSPECTION",
        budget_cents: 5_000,
        currency: "USD",
        location: { latitude: 12.9716, longitude: 77.5946 },
        idempotency_key: "phase8-zero-fee-job",
      },
    });
    const zeroFeeJob = response.json<{ data: { id: string } }>().data;
    assert(response.statusCode === 201, "zero-fee job creation remains valid");
    response = await app.inject({
      method: "POST",
      url: `/api/v1/client/jobs/${zeroFeeJob.id}/fund`,
      headers: bearer(clientToken),
      payload: { idempotency_key: "phase8-zero-fee-funding" },
    });
    const zeroFeeFunding = response.json<{ data: { operationId: string; providerReference: string } }>().data;
    const zeroFeeFundingWebhook = webhookPayload(`evt_zero_fee_fund_${seed}`, "payment_intent.succeeded", zeroFeeFunding.providerReference, zeroFeeFunding.operationId);
    response = await app.inject({
      method: "POST",
      url: "/api/v1/webhooks/payments",
      headers: { "content-type": "application/json", "stripe-signature": signPaymentWebhook(Buffer.from(zeroFeeFundingWebhook)) },
      payload: zeroFeeFundingWebhook,
    });
    assert(response.statusCode === 200, "zero-fee funding webhook settles escrow");
    response = await app.inject({ method: "POST", url: `/api/v1/worker/jobs/${zeroFeeJob.id}/accept`, headers: bearer(workerToken) });
    assert(response.statusCode === 200, "worker can claim a funded zero-fee job");
    for (const status of ["EN_ROUTE", "AT_LOCATION", "IN_PROGRESS"] as const) {
      response = await app.inject({
        method: "POST",
        url: "/api/v1/work/status",
        headers: bearer(workerToken),
        payload: { job_id: zeroFeeJob.id, status },
      });
      assert(response.statusCode === 200, `worker advances zero-fee work to ${status}`);
    }
    response = await app.inject({ method: "POST", url: "/api/v1/work/submit", headers: bearer(workerToken), payload: { job_id: zeroFeeJob.id } });
    assert(response.statusCode === 200, "worker submits zero-fee work");
    response = await app.inject({
      method: "POST",
      url: `/api/v1/client/jobs/${zeroFeeJob.id}/approve`,
      headers: bearer(clientToken),
      payload: { idempotency_key: "phase8-zero-fee-approval" },
    });
    const zeroFeeApproval = response.json<{ data: { payoutAmountCents: string } }>().data;
    assert(response.statusCode === 200 && zeroFeeApproval.payoutAmountCents === "5000", "zero-fee approval releases the full worker payout");
    const zeroFeeSettlement = await pool.query<{ entries: string; total: string }>(
      `SELECT COUNT(*)::text AS entries, SUM(amount_cents)::text AS total FROM wallet_ledger WHERE job_id = $1 AND transaction_type IN ('ESCROW_RELEASE', 'WORKER_PAYOUT')`,
      [zeroFeeJob.id],
    );
    assert(zeroFeeSettlement.rows[0]?.entries === "2" && zeroFeeSettlement.rows[0]?.total === "0", "zero-fee settlement omits the invalid zero-value fee posting");
    config.PLATFORM_FEE_BPS = originalFeeBps;

    response = await app.inject({ method: "POST", url: `/api/v1/client/jobs/${created.id}/fund`, headers: bearer(workerToken), payload: { idempotency_key: "worker-cannot-fund" } });
    assert(response.statusCode === 403, "worker cannot fund a client job");
    response = await app.inject({ method: "GET", url: "/api/v1/client/wallet", headers: bearer(workerToken) });
    assert(response.statusCode === 403, "worker cannot read a client wallet route");

    response = await app.inject({
      method: "POST",
      url: "/api/v1/client/jobs",
      headers: bearer(clientToken),
      payload: {
        title: "Failed funding inspection",
        description: "A second job used to ensure failed payments never publish work.",
        category: "INSPECTION",
        budget_cents: 5_000,
        currency: "USD",
        location: { latitude: 12.9716, longitude: 77.5946 },
        idempotency_key: "phase8-failed-job-key",
      },
    });
    const failedJob = response.json<{ data: { id: string } }>().data;
    response = await app.inject({ method: "POST", url: `/api/v1/client/jobs/${failedJob.id}/fund`, headers: bearer(clientToken), payload: { idempotency_key: "phase8-failed-funding" } });
    const failedFunding = response.json<{ data: { operationId: string; providerReference: string } }>().data;
    const failedWebhook = webhookPayload(`evt_failed_${seed}`, "payment_intent.payment_failed", failedFunding.providerReference, failedFunding.operationId);
    response = await app.inject({
      method: "POST",
      url: "/api/v1/webhooks/payments",
      headers: { "content-type": "application/json", "stripe-signature": signPaymentWebhook(Buffer.from(failedWebhook)) },
      payload: failedWebhook,
    });
    assert(response.statusCode === 200 && response.json<{ data: { status: string } }>().data.status === "FAILED", "failed funding webhook marks pending journal failed");
    const failedState = await pool.query<{ status: string; escrow_status: string }>(`SELECT status, escrow_status FROM jobs WHERE id = $1`, [failedJob.id]);
    assert(failedState.rows[0]?.status === "FUNDING" && failedState.rows[0]?.escrow_status === "UNFUNDED", "failed escrow never publishes a worker-visible job");

    response = await app.inject({
      method: "POST",
      url: "/api/v1/client/jobs",
      headers: bearer(clientToken),
      payload: {
        title: "Early webhook inspection",
        description: "A provider event may arrive before its reference is persisted locally.",
        category: "INSPECTION",
        budget_cents: 3_000,
        currency: "USD",
        location: { latitude: 12.9716, longitude: 77.5946 },
        idempotency_key: "phase8-early-webhook-job",
      },
    });
    const earlyWebhookJob = response.json<{ data: { id: string } }>().data;
    response = await app.inject({
      method: "POST",
      url: `/api/v1/client/jobs/${earlyWebhookJob.id}/fund`,
      headers: bearer(clientToken),
      payload: { idempotency_key: "phase8-early-webhook-funding" },
    });
    const earlyWebhookFunding = response.json<{ data: { operationId: string; providerReference: string } }>().data;
    await pool.query(
      `UPDATE payment_operations SET provider_reference = NULL, status = 'CREATED' WHERE id = $1`,
      [earlyWebhookFunding.operationId],
    );
    const earlyWebhook = webhookPayload(
      `evt_early_fund_${seed}`,
      "payment_intent.succeeded",
      earlyWebhookFunding.providerReference,
      earlyWebhookFunding.operationId,
    );
    response = await app.inject({
      method: "POST",
      url: "/api/v1/webhooks/payments",
      headers: { "content-type": "application/json", "stripe-signature": signPaymentWebhook(Buffer.from(earlyWebhook)) },
      payload: earlyWebhook,
    });
    const earlyWebhookState = await pool.query<{ status: string; escrow_status: string }>(
      `SELECT status, escrow_status FROM jobs WHERE id = $1`,
      [earlyWebhookJob.id],
    );
    assert(
      response.statusCode === 200 &&
        earlyWebhookState.rows[0]?.status === "POSTED" &&
        earlyWebhookState.rows[0]?.escrow_status === "HELD",
      "a verified early webhook attaches to its operation metadata and settles escrow",
    );

    response = await app.inject({
      method: "POST",
      url: "/api/v1/client/jobs",
      headers: bearer(clientToken),
      payload: {
        title: "Suspended funding inspection",
        description: "Funding received after suspension must stay frozen and private.",
        category: "INSPECTION",
        budget_cents: 4_000,
        currency: "USD",
        location: { latitude: 12.9716, longitude: 77.5946 },
        idempotency_key: "phase8-suspended-funding-job",
      },
    });
    const suspendedFundingJob = response.json<{ data: { id: string } }>().data;
    response = await app.inject({
      method: "POST",
      url: `/api/v1/client/jobs/${suspendedFundingJob.id}/fund`,
      headers: bearer(clientToken),
      payload: { idempotency_key: "phase8-suspended-funding" },
    });
    const suspendedFunding = response.json<{ data: { operationId: string; providerReference: string } }>().data;
    const admin = await pool.query<{ id: string }>(
      `INSERT INTO users (phone_number, full_name, role, is_active, is_verified) VALUES ($1, 'Phase 8 Admin', 'ADMIN', TRUE, TRUE) RETURNING id`,
      [`+1888${seed.slice(0, 7)}`.slice(0, 15)],
    );
    const adminId = admin.rows[0]?.id;
    if (!adminId) throw new Error("Could not create Phase 8 admin");
    userIds.push(adminId);
    await pool.query(`SELECT * FROM admin_suspend_user($1, $2, 'Freeze funding after account suspension')`, [adminId, users.client.id]);
    const suspendedFundingWebhook = webhookPayload(
      `evt_suspended_fund_${seed}`,
      "payment_intent.succeeded",
      suspendedFunding.providerReference,
      suspendedFunding.operationId,
    );
    response = await app.inject({
      method: "POST",
      url: "/api/v1/webhooks/payments",
      headers: { "content-type": "application/json", "stripe-signature": signPaymentWebhook(Buffer.from(suspendedFundingWebhook)) },
      payload: suspendedFundingWebhook,
    });
    const suspendedFundingState = await pool.query<{ status: string; escrow_status: string }>(
      `SELECT status, escrow_status FROM jobs WHERE id = $1`,
      [suspendedFundingJob.id],
    );
    assert(
      response.statusCode === 200 &&
        suspendedFundingState.rows[0]?.status === "FUNDING" &&
        suspendedFundingState.rows[0]?.escrow_status === "FROZEN",
      "late funding for a suspended client settles into frozen escrow without publishing work",
    );

    // eslint-disable-next-line no-console
    console.log("\nPhase 8 verification complete: all checks passed.");
  } finally {
    config.PLATFORM_FEE_BPS = originalFeeBps;
    await app.close();
    await deleteSeedData(userIds);
    await closeConnections();
  }
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error("\nPhase 8 verification FAILED:", err);
  process.exit(1);
});
