package com.networkpeer.mobile.core.evidence

import com.networkpeer.mobile.core.model.NetworkPeerApiException
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.IOException
import java.net.SocketTimeoutException
import java.net.UnknownHostException

class EvidenceRetryPolicyTest {

    // A worker photographing pages in a basement or a village loses the connection
    // constantly. Parking a photo on any of these would silently lose their work.
    @Test
    fun `transport failures are always retryable`() {
        listOf(
            SocketTimeoutException("timeout"),
            UnknownHostException("api.networkpeer"),
            IOException("unexpected end of stream"),
            IllegalStateException("something local"),
        ).forEach { failure ->
            assertFalse(failure.toString(), EvidenceRetryPolicy.isPermanent(failure))
        }
    }

    @Test
    fun `server faults are retryable`() {
        listOf(500, 502, 503, 504).forEach { status ->
            val failure = NetworkPeerApiException("UPSTREAM", "upstream failed", status)
            assertFalse("HTTP $status", EvidenceRetryPolicy.isPermanent(failure))
        }
    }

    @Test
    fun `timeout and rate limit mean later, not never`() {
        assertFalse(EvidenceRetryPolicy.isPermanent(NetworkPeerApiException("TIMEOUT", "timeout", 408)))
        assertFalse(EvidenceRetryPolicy.isPermanent(NetworkPeerApiException("RATE_LIMITED", "slow down", 429)))
    }

    // These are the cases a blanket "4xx is permanent" rule got wrong. Each carries a
    // 4xx status but is repaired by re-reserving under the same idempotency key, so
    // each must stay retryable regardless of its status code.
    @Test
    fun `S3 rejecting the upload is retryable whatever status it carries`() {
        // 403 is what an expired presigned POST target returns -- the single most
        // likely failure for a photo that sat in the queue while the phone was offline.
        listOf(403, 400, 409, 500, 503).forEach { status ->
            val failure = NetworkPeerApiException("EVIDENCE_UPLOAD_FAILED", "S3 rejected ($status).", status)
            assertFalse("HTTP $status", EvidenceRetryPolicy.isPermanent(failure))
        }
    }

    @Test
    fun `an expired reservation is retryable`() {
        assertFalse(EvidenceRetryPolicy.isPermanent(NetworkPeerApiException("UPLOAD_EXPIRED", "expired", 409)))
    }

    @Test
    fun `an object that never landed is retryable`() {
        assertFalse(EvidenceRetryPolicy.isPermanent(NetworkPeerApiException("UPLOAD_NOT_FOUND", "missing", 409)))
    }

    @Test
    fun `a lapsed session is retryable`() {
        // Signing in again makes the queued photo sendable; parking it would discard
        // work the worker is about to be able to submit.
        assertFalse(EvidenceRetryPolicy.isPermanent(NetworkPeerApiException("UNAUTHORIZED", "expired token", 401)))
    }

    @Test
    fun `every named retryable code survives its own status code`() {
        EvidenceRetryPolicy.RETRYABLE_CODES.forEach { code ->
            listOf(null, 400, 401, 403, 404, 409, 429, 500).forEach { status ->
                assertFalse(
                    "$code / $status",
                    EvidenceRetryPolicy.isPermanent(NetworkPeerApiException(code, code, status)),
                )
            }
        }
    }

    @Test
    fun `the two sets do not overlap`() {
        // An overlap would make the outcome depend on check order, which is exactly
        // the ambiguity this split exists to remove.
        val both = EvidenceRetryPolicy.RETRYABLE_CODES intersect EvidenceRetryPolicy.PERMANENT_CODES
        assertTrue("codes in both sets: $both", both.isEmpty())
    }

    @Test
    fun `verdicts retrying cannot change are permanent`() {
        EvidenceRetryPolicy.PERMANENT_CODES.forEach { code ->
            assertTrue(code, EvidenceRetryPolicy.isPermanent(NetworkPeerApiException(code, code)))
        }
    }

    @Test
    fun `a client error the API already judged is permanent`() {
        assertTrue(EvidenceRetryPolicy.isPermanent(NetworkPeerApiException("BAD_REQUEST", "nope", 400)))
        assertTrue(EvidenceRetryPolicy.isPermanent(NetworkPeerApiException("FORBIDDEN", "nope", 403)))
    }

    @Test
    fun `backoff doubles from the base and stops at the ceiling`() {
        assertEquals(EvidenceRetryPolicy.BACKOFF_BASE_MS, EvidenceRetryPolicy.backoffMs(1))
        assertEquals(EvidenceRetryPolicy.BACKOFF_BASE_MS * 2, EvidenceRetryPolicy.backoffMs(2))
        assertEquals(EvidenceRetryPolicy.BACKOFF_BASE_MS * 4, EvidenceRetryPolicy.backoffMs(3))
        assertEquals(EvidenceRetryPolicy.BACKOFF_CEILING_MS, EvidenceRetryPolicy.backoffMs(40))
    }

    @Test
    fun `backoff never overflows or goes backwards`() {
        // attempts is read from durable storage, so it can be anything; a negative
        // delay would make an item eligible forever and spin the drain.
        var previous = 0L
        (1..200).forEach { attempts ->
            val delay = EvidenceRetryPolicy.backoffMs(attempts)
            assertTrue("attempt $attempts produced $delay", delay > 0)
            assertTrue("attempt $attempts went backwards", delay >= previous)
            assertTrue("attempt $attempts exceeded ceiling", delay <= EvidenceRetryPolicy.BACKOFF_CEILING_MS)
            previous = delay
        }
        assertTrue(EvidenceRetryPolicy.backoffMs(0) > 0)
        assertTrue(EvidenceRetryPolicy.backoffMs(-5) > 0)
    }

    @Test
    fun `nextAttemptAt is in the future relative to the clock it is given`() {
        val now = 1_700_000_000_000L
        assertEquals(now + EvidenceRetryPolicy.BACKOFF_BASE_MS, EvidenceRetryPolicy.nextAttemptAt(1, now))
    }
}
