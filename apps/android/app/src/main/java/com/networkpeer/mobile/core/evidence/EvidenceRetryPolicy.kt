package com.networkpeer.mobile.core.evidence

import com.networkpeer.mobile.core.model.NetworkPeerApiException

/**
 * Decides whether a failed evidence upload is worth retrying, and when.
 *
 * Kept separate from DurableEvidenceUploadQueue, and free of Android types, because
 * this is the part most easily got wrong: classify a transient network fault as
 * permanent and the photo is silently abandoned, classify a rejected file as
 * transient and the queue retries it on a timer forever. It is unit-tested in
 * EvidenceRetryPolicyTest.
 */
object EvidenceRetryPolicy {
    const val BACKOFF_BASE_MS = 15_000L
    const val BACKOFF_CEILING_MS = 30 * 60 * 1000L

    /**
     * Failures that a later attempt genuinely can fix, checked BEFORE anything else.
     *
     * This set exists because a blanket "4xx means permanent" rule is wrong for this
     * API: UPLOAD_EXPIRED and UPLOAD_NOT_FOUND are both 409s, and an expired
     * presigned POST comes back from S3 as a 403 under EVIDENCE_UPLOAD_FAILED. All
     * three are repaired by re-reserving -- the uploader replays the same idempotency
     * key, which refreshes upload_expires_at and mints a fresh target -- so treating
     * them as final would discard a photo for no reason.
     */
    val RETRYABLE_CODES: Set<String> = setOf(
        // The reservation's ten-minute window lapsed while the phone was offline.
        "UPLOAD_EXPIRED",
        // The object never landed in S3, so the whole upload is worth replaying.
        "UPLOAD_NOT_FOUND",
        // S3 refused the POST: an expired target, a throttle, or a transient 5xx.
        "EVIDENCE_UPLOAD_FAILED",
        "RATE_LIMITED",
        // A lapsed session is fixed by a refresh or the worker signing in again.
        // Parking the photo would discard work that is about to become sendable.
        "UNAUTHORIZED",
    )

    /**
     * Failures retrying cannot fix: the file no longer matches its reservation, is
     * too large or of a rejected type, is unreadable, or the job has stopped
     * accepting evidence. These are parked for the worker to retake or retry by hand.
     */
    val PERMANENT_CODES: Set<String> = setOf(
        "EVIDENCE_CHANGED",
        "MEDIA_TOO_LARGE",
        "MEDIA_TYPE_NOT_ALLOWED",
        "MEDIA_TYPE_UNKNOWN",
        "EVIDENCE_UNREADABLE",
        "EVIDENCE_NOT_FOUND",
        "EVIDENCE_NOT_ACCEPTING_UPLOAD",
        "IDEMPOTENCY_KEY_REUSED",
        "CAPTURE_TIME_INVALID",
        "WORK_NOT_FOUND",
        "WORKER_NOT_VERIFIED",
    )

    fun isPermanent(failure: Throwable): Boolean {
        // Anything that is not an API verdict -- a socket timeout, a DNS failure, a
        // dropped connection -- is transient by definition. This is the common case
        // for a worker on a rural mobile connection and must never park a photo.
        val api = failure as? NetworkPeerApiException ?: return false
        if (api.code in RETRYABLE_CODES) return false
        if (api.code in PERMANENT_CODES) return true
        val status = api.statusCode ?: return false
        // A 4xx the API has already judged, and did not name above, will be judged the
        // same way next time. 408 and 429 are the two that mean "later".
        return status in 400..499 && status != 408 && status != 429
    }

    /**
     * Exponential backoff from the attempt count, doubling from 15s to a 30-minute
     * ceiling. `attempts` is the number of attempts made including the one that just
     * failed, so the first failure waits BACKOFF_BASE_MS.
     */
    fun backoffMs(attempts: Int): Long {
        val shift = (attempts - 1).coerceIn(0, 12)
        return (BACKOFF_BASE_MS shl shift).coerceAtMost(BACKOFF_CEILING_MS)
    }

    fun nextAttemptAt(attempts: Int, nowMs: Long): Long = nowMs + backoffMs(attempts)
}
