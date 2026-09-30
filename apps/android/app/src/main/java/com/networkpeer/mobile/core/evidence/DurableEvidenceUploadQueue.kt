package com.networkpeer.mobile.core.evidence

import android.content.Context
import android.net.Uri
import com.networkpeer.mobile.core.data.DurableAppState
import com.networkpeer.mobile.core.data.PendingEvidenceUpload
import com.networkpeer.mobile.core.model.EvidenceSummary
import com.networkpeer.mobile.core.model.Point
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.async
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.sync.Semaphore
import kotlinx.coroutines.sync.withPermit
import kotlinx.coroutines.withContext
import java.time.Instant
import java.util.UUID

/**
 * Persists each evidence request before networking. Retrying reuses its immutable
 * metadata and idempotency key, which is required by the upload contract.
 *
 * Enqueueing and uploading used to be one suspending call the task screen awaited
 * on its own `rememberCoroutineScope`. Three things followed from that:
 *
 *  - Navigating away from the job cancelled the scope mid-upload, so the photo was
 *    abandoned with an orphaned S3 reservation and no error recorded against it.
 *  - `retry` changed no dispatcher, so it inherited Dispatchers.Main from the UI.
 *    Every confirm then ran DurableAppState's SharedPreferences.commit() -- a
 *    synchronous fsync over a re-serialised list of up to 500 items -- on the main
 *    thread, twice per photo. That is what made the app stall and then die.
 *  - A single process-wide Mutex meant one upload at a time, and the screen
 *    disabled every capture button while it ran.
 *
 * So enqueueing is now only a durable write, the drain runs off the main thread
 * under a bounded number of permits, and nothing here is tied to a composable's
 * lifetime. EvidenceUploadWorker owns the drain; see EvidenceUploadScheduler.
 */
class DurableEvidenceUploadQueue(
    private val context: Context,
    private val uploader: EvidenceUploader,
    private val state: DurableAppState,
) {
    private val slots = Semaphore(MAX_CONCURRENT_UPLOADS)
    private val inFlightLock = Any()
    private val inFlight = mutableSetOf<String>()

    /** What a drain pass concluded, so the Worker knows whether to ask for another. */
    data class DrainOutcome(
        val uploaded: Int,
        /** Items still queued and retryable -- the caller should schedule another pass. */
        val retryable: Int,
        /** Items parked awaiting an explicit retake or retry by the worker. */
        val blocked: Int,
    )

    /**
     * Records the capture durably and returns immediately. The bytes are already on
     * local storage -- the camera wrote them straight into filesDir via the evidence
     * FileProvider -- so this only has to persist the intent to send them.
     *
     * The file is inspected first because its checksum and size are part of the
     * reservation, and because a file that cannot be read should fail here, in front
     * of the worker, rather than silently inside a background drain.
     */
    suspend fun enqueue(
        jobId: String,
        subtaskId: String,
        uri: Uri,
        capturedAt: Instant = Instant.now(),
        location: Point? = null,
        appOwnedUri: Boolean = false,
    ): PendingEvidenceUpload = withContext(Dispatchers.IO) {
        val uploadMetadata = try {
            uploader.inspect(uri)
        } catch (failure: Throwable) {
            if (failure is CancellationException) throw failure
            if (appOwnedUri) EvidenceCapture.delete(context, uri)
            throw failure
        }
        val item = PendingEvidenceUpload(
            id = UUID.randomUUID().toString(),
            jobId = jobId,
            subtaskId = subtaskId,
            uri = uri.toString(),
            capturedAt = capturedAt.toString(),
            location = location,
            idempotencyKey = UUID.randomUUID().toString(),
            uploadMetadata = uploadMetadata,
            appOwnedUri = appOwnedUri,
        )
        state.enqueueEvidence(item)
        item
    }

    /**
     * Uploads every queued item that is eligible now, up to MAX_CONCURRENT_UPLOADS at
     * a time. Failures are recorded against their own item and never propagate: one
     * unreadable photo must not strand the twenty behind it.
     */
    suspend fun drain(onProgress: (remaining: Int) -> Unit = {}): DrainOutcome =
        withContext(Dispatchers.IO) {
            var uploaded = 0
            // Re-read between passes: a capture made while this one ran should be
            // picked up without waiting for the Worker to be scheduled again.
            while (true) {
                val batch = eligible().filterNot { isInFlight(it.id) }
                if (batch.isEmpty()) break
                val results = coroutineScope {
                    batch.map { item ->
                        async {
                            if (!claim(item.id)) return@async false
                            try {
                                slots.withPermit { uploadOne(item) != null }
                            } finally {
                                release(item.id)
                            }
                        }
                    }.map { it.await() }
                }
                uploaded += results.count { it }
                onProgress(pending().size)
                // Every failure above recorded either a backoff or a permanent flag, so
                // eligible() strictly shrinks and the loop terminates on its own. This
                // is the belt-and-braces stop: if a whole batch failed, do not
                // immediately re-examine the queue looking for more work.
                if (results.none { it }) break
            }
            val remaining = pending()
            DrainOutcome(
                uploaded = uploaded,
                retryable = remaining.count { !it.permanentFailure },
                blocked = remaining.count { it.permanentFailure },
            )
        }

    /** An explicit retry from the UI: clears backoff, then uploads that one item. */
    suspend fun retry(id: String): EvidenceSummary? = withContext(Dispatchers.IO) {
        state.clearEvidenceBackoff(id)
        val item = pending().firstOrNull { it.id == id } ?: return@withContext null
        if (!claim(id)) return@withContext null
        try {
            slots.withPermit { uploadOne(item, rethrow = true) }
        } finally {
            release(id)
        }
    }

    /**
     * Uploads one item, recording the outcome against it. Returns null on failure
     * unless `rethrow` is set, which the UI's explicit retry uses so it can show the
     * worker why their press did not work.
     */
    private suspend fun uploadOne(
        item: PendingEvidenceUpload,
        rethrow: Boolean = false,
    ): EvidenceSummary? {
        return try {
            val result = uploader.upload(
                jobId = item.jobId,
                subtaskId = item.subtaskId,
                uri = Uri.parse(item.uri),
                capturedAt = Instant.parse(item.capturedAt),
                location = item.location,
                idempotencyKey = item.idempotencyKey,
                expectedMetadata = item.uploadMetadata,
            )
            state.recordConfirmedEvidence(result.evidence)
            state.removePendingEvidence(item.id)
            // The local copy has served its purpose once the API has confirmed the
            // object. A gallery-picked file is not ours and is left alone.
            if (item.appOwnedUri) EvidenceCapture.delete(context, Uri.parse(item.uri))
            result.evidence
        } catch (failure: CancellationException) {
            // A cancelled drain is not a failed upload. Leave the item untouched and
            // unattempted so the next pass picks it up as-is.
            throw failure
        } catch (failure: Throwable) {
            val permanent = EvidenceRetryPolicy.isPermanent(failure)
            state.markEvidenceAttempt(
                id = item.id,
                error = failure.message ?: "Evidence upload needs to be retried.",
                nextAttemptAtEpochMs = if (permanent) {
                    0L
                } else {
                    EvidenceRetryPolicy.nextAttemptAt(item.attempts + 1, System.currentTimeMillis())
                },
                permanentFailure = permanent,
            )
            if (rethrow) throw failure
            null
        }
    }

    private fun pending(): List<PendingEvidenceUpload> = state.pendingEvidence.value

    /** Queued, not parked on a permanent failure, and past its backoff window. */
    private fun eligible(): List<PendingEvidenceUpload> {
        val now = System.currentTimeMillis()
        return pending().filter { !it.permanentFailure && it.nextAttemptAtEpochMs <= now }
    }

    fun pendingCount(): Int = pending().size

    fun hasRetryableWork(): Boolean = pending().any { !it.permanentFailure }

    private fun claim(id: String): Boolean = synchronized(inFlightLock) { inFlight.add(id) }

    private fun release(id: String) {
        synchronized(inFlightLock) { inFlight.remove(id) }
    }

    private fun isInFlight(id: String): Boolean = synchronized(inFlightLock) { id in inFlight }

    private companion object {
        /**
         * Enough to keep a phone's uplink busy while photographing the next page,
         * without putting twenty 25 MiB multipart bodies in flight on a rural
         * connection and timing all of them out.
         */
        const val MAX_CONCURRENT_UPLOADS = 3
    }
}
