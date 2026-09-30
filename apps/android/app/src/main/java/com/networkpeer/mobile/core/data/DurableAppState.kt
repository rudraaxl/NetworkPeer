package com.networkpeer.mobile.core.data

import android.content.Context
import android.content.SharedPreferences
import com.networkpeer.mobile.core.model.AppNotification
import com.networkpeer.mobile.core.model.EvidenceSummary
import com.networkpeer.mobile.core.model.Point
import com.networkpeer.mobile.core.model.SyncEvent
import com.networkpeer.mobile.core.model.WorkerJobDetail
import com.networkpeer.mobile.core.evidence.EvidenceUploadMetadata
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.serialization.Serializable
import kotlinx.serialization.builtins.ListSerializer
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonPrimitive
import java.security.MessageDigest
import java.time.Instant
import java.util.UUID

@Serializable
data class PendingEvidenceUpload(
    val id: String,
    val jobId: String,
    val subtaskId: String,
    val uri: String,
    val capturedAt: String,
    val location: Point? = null,
    val idempotencyKey: String,
    val uploadMetadata: EvidenceUploadMetadata? = null,
    val appOwnedUri: Boolean = false,
    val attempts: Int = 0,
    val lastError: String? = null,
    /**
     * Epoch millis before which this item must not be retried. The upload used to
     * be retried only when the worker reopened the job screen, so `attempts` was
     * recorded and never read. It now drives exponential backoff in
     * DurableEvidenceUploadQueue.
     */
    val nextAttemptAtEpochMs: Long = 0L,
    /**
     * Set when the failure cannot be fixed by retrying -- a changed or oversized
     * file, a rejected MIME type, or a job that is no longer accepting evidence.
     * The background drain skips these so it does not spin forever; only an
     * explicit retry or retake clears them.
     */
    val permanentFailure: Boolean = false,
)

@Serializable
data class LocalInboxItem(
    val id: String,
    val cursor: String? = null,
    val topic: String,
    val title: String,
    val body: String,
    val data: JsonObject = JsonObject(emptyMap()),
    val jobId: String? = null,
    val createdAt: String,
    val readAt: String? = null,
)

/**
 * User-scoped, durable operational state. API data remains authoritative; this store only
 * retains retry metadata, API-sourced sync/notification cache data, and the sync cursor between launches.
 */
class DurableAppState(context: Context) {
    private val preferences: SharedPreferences = context.getSharedPreferences(PREFERENCES_NAME, Context.MODE_PRIVATE)
    private val json = Json { ignoreUnknownKeys = true; encodeDefaults = true }
    private var activeUserId: String? = null

    private val _pendingEvidence = MutableStateFlow<List<PendingEvidenceUpload>>(emptyList())
    val pendingEvidence = _pendingEvidence.asStateFlow()

    private val _confirmedEvidence = MutableStateFlow<List<EvidenceSummary>>(emptyList())
    val confirmedEvidence = _confirmedEvidence.asStateFlow()

    private val _inbox = MutableStateFlow<List<LocalInboxItem>>(emptyList())
    val inbox = _inbox.asStateFlow()

    private val _syncCursor = MutableStateFlow("0")
    val syncCursor = _syncCursor.asStateFlow()

    private val _workerJobs = MutableStateFlow<List<WorkerJobDetail>>(emptyList())
    val workerJobs = _workerJobs.asStateFlow()

    @Synchronized
    fun activate(userId: String?) {
        if (activeUserId == userId) return
        activeUserId = userId
        if (userId == null) {
            _pendingEvidence.value = emptyList()
            _confirmedEvidence.value = emptyList()
            _inbox.value = emptyList()
            _syncCursor.value = "0"
            _workerJobs.value = emptyList()
            return
        }
        _pendingEvidence.value = readList(PENDING_EVIDENCE, PendingEvidenceUpload.serializer())
        _confirmedEvidence.value = readList(CONFIRMED_EVIDENCE, EvidenceSummary.serializer())
        _inbox.value = readList(INBOX, LocalInboxItem.serializer()).sortedByDescending { it.createdAt }
        _syncCursor.value = scopedValue(SYNC_CURSOR) ?: "0"
        _workerJobs.value = readList(WORKER_JOBS, WorkerJobDetail.serializer())
    }

    @Synchronized
    fun isActiveUser(userId: String): Boolean = activeUserId == userId

    @Synchronized
    fun syncCursorFor(userId: String): String? = _syncCursor.value.takeIf { activeUserId == userId }

    @Synchronized
    fun clearUserData(userId: String) {
        listOf(PENDING_EVIDENCE, CONFIRMED_EVIDENCE, INBOX, SYNC_CURSOR, WORKER_JOBS).forEach { key ->
            preferences.edit().remove(scopedKey(userId, key)).commit()
        }
        preferences.all.keys
            .filter { it.startsWith("$IDEMPOTENCY_PREFIX$userId.") }
            .forEach { key -> preferences.edit().remove(key).commit() }
        if (activeUserId == userId) {
            _pendingEvidence.value = emptyList()
            _confirmedEvidence.value = emptyList()
            _inbox.value = emptyList()
            _syncCursor.value = "0"
            _workerJobs.value = emptyList()
        }
    }

    @Synchronized
    fun idempotencyKey(operation: String, fingerprint: String = ""): String {
        val userId = requireActiveUser()
        val key = IDEMPOTENCY_PREFIX + userId + "." + hash("$operation:$fingerprint")
        return preferences.getString(key, null) ?: UUID.randomUUID().toString().also { generated ->
            preferences.edit().putString(key, generated).commit()
        }
    }

    @Synchronized
    fun clearIdempotencyKey(operation: String, fingerprint: String = "") {
        val userId = activeUserId ?: return
        preferences.edit().remove("$IDEMPOTENCY_PREFIX$userId.${hash("$operation:$fingerprint")}").commit()
    }

    @Synchronized
    fun enqueueEvidence(item: PendingEvidenceUpload) {
        val next = _pendingEvidence.value.filterNot { it.id == item.id } + item
        _pendingEvidence.value = next
        writeList(PENDING_EVIDENCE, PendingEvidenceUpload.serializer(), next)
    }

    @Synchronized
    fun markEvidenceAttempt(
        id: String,
        error: String? = null,
        nextAttemptAtEpochMs: Long = 0L,
        permanentFailure: Boolean = false,
    ) {
        val next = _pendingEvidence.value.map { item ->
            if (item.id == id) {
                item.copy(
                    attempts = item.attempts + 1,
                    lastError = error,
                    nextAttemptAtEpochMs = nextAttemptAtEpochMs,
                    permanentFailure = permanentFailure,
                )
            } else {
                item
            }
        }
        _pendingEvidence.value = next
        writeList(PENDING_EVIDENCE, PendingEvidenceUpload.serializer(), next)
    }

    /** Clears backoff and the permanent flag so an explicit retry is attempted at once. */
    @Synchronized
    fun clearEvidenceBackoff(id: String) {
        val next = _pendingEvidence.value.map { item ->
            if (item.id == id) item.copy(nextAttemptAtEpochMs = 0L, permanentFailure = false) else item
        }
        _pendingEvidence.value = next
        writeList(PENDING_EVIDENCE, PendingEvidenceUpload.serializer(), next)
    }

    @Synchronized
    fun removePendingEvidence(id: String) {
        val next = _pendingEvidence.value.filterNot { it.id == id }
        _pendingEvidence.value = next
        writeList(PENDING_EVIDENCE, PendingEvidenceUpload.serializer(), next)
    }

    @Synchronized
    fun recordConfirmedEvidence(evidence: EvidenceSummary) {
        val next = (_confirmedEvidence.value.filterNot { it.id == evidence.id } + evidence)
            .sortedByDescending { it.captured_at }
            .take(MAX_CONFIRMED_EVIDENCE)
        _confirmedEvidence.value = next
        writeList(CONFIRMED_EVIDENCE, EvidenceSummary.serializer(), next)
    }

    @Synchronized
    fun recordSync(userId: String, events: List<SyncEvent>, nextCursor: String): Boolean {
        if (activeUserId != userId) return false
        _syncCursor.value = nextCursor
        preferences.edit().putString(scopedKey(userId, SYNC_CURSOR), nextCursor).commit()

        if (events.isEmpty()) return true
        val existing = _inbox.value.associateBy { it.id }.toMutableMap()
        events.forEach { event ->
            val notification = event.notification ?: return@forEach
            existing[notification.id] = LocalInboxItem(
                id = notification.id,
                cursor = event.cursor,
                topic = event.topic,
                title = notification.title,
                body = notification.body,
                data = event.payload,
                jobId = event.entity_id.takeIf { event.entity_type.equals("job", ignoreCase = true) },
                createdAt = event.created_at,
                readAt = notification.read_at,
            )
        }
        val next = existing.values.sortedByDescending { it.createdAt }.take(MAX_INBOX_ITEMS)
        _inbox.value = next
        writeList(INBOX, LocalInboxItem.serializer(), next)
        return true
    }

    @Synchronized
    fun recordNotifications(notifications: List<AppNotification>) {
        val existing = _inbox.value.associateBy { it.id }.toMutableMap()
        notifications.forEach { notification ->
            existing[notification.id] = LocalInboxItem(
                id = notification.id,
                cursor = notification.cursor,
                topic = notification.topic,
                title = notification.title,
                body = notification.body,
                data = notification.data,
                jobId = notification.data["job_id"]?.jsonPrimitive?.contentOrNull
                    ?: notification.data["jobId"]?.jsonPrimitive?.contentOrNull,
                createdAt = notification.created_at,
                readAt = notification.read_at,
            )
        }
        val next = existing.values.sortedByDescending { it.createdAt }.take(MAX_INBOX_ITEMS)
        _inbox.value = next
        writeList(INBOX, LocalInboxItem.serializer(), next)
    }

    @Synchronized
    fun recordWorkerSync(
        userId: String,
        jobs: List<WorkerJobDetail>,
        snapshotJobs: List<WorkerJobDetail>,
        removedJobIds: List<String>,
    ): Boolean {
        if (activeUserId != userId) return false
        val merged = _workerJobs.value
            .filterNot { it.id in removedJobIds }
            .associateBy { it.id }
            .toMutableMap()
        (snapshotJobs + jobs).forEach { job -> merged[job.id] = job }
        val next = merged.values.sortedByDescending { it.updated_at }.take(MAX_WORKER_JOBS)
        _workerJobs.value = next
        writeList(WORKER_JOBS, WorkerJobDetail.serializer(), next)
        return true
    }

    @Synchronized
    fun markInboxRead(id: String) {
        val now = Instant.now().toString()
        val next = _inbox.value.map { item -> if (item.id == id) item.copy(readAt = item.readAt ?: now) else item }
        _inbox.value = next
        writeList(INBOX, LocalInboxItem.serializer(), next)
    }

    @Synchronized
    fun markAllInboxRead() {
        val now = Instant.now().toString()
        val next = _inbox.value.map { item -> item.copy(readAt = item.readAt ?: now) }
        _inbox.value = next
        writeList(INBOX, LocalInboxItem.serializer(), next)
    }

    private fun requireActiveUser(): String = requireNotNull(activeUserId) { "No authenticated user is active." }

    private fun scopedValue(name: String): String? = activeUserId?.let { preferences.getString(scopedKey(it, name), null) }

    private fun scopedKey(userId: String, name: String): String = "$STATE_PREFIX$userId.$name"

    private fun <T> readList(name: String, serializer: kotlinx.serialization.KSerializer<T>): List<T> {
        val raw = scopedValue(name) ?: return emptyList()
        return runCatching { json.decodeFromString(ListSerializer(serializer), raw) }.getOrDefault(emptyList())
    }

    private fun <T> writeList(name: String, serializer: kotlinx.serialization.KSerializer<T>, value: List<T>) {
        val userId = activeUserId ?: return
        preferences.edit()
            .putString(scopedKey(userId, name), json.encodeToString(ListSerializer(serializer), value))
            .commit()
    }

    private fun hash(value: String): String = MessageDigest.getInstance("SHA-256")
        .digest(value.toByteArray(Charsets.UTF_8))
        .joinToString("") { byte -> "%02x".format(byte.toInt() and 0xff) }

    private companion object {
        const val PREFERENCES_NAME = "networkpeer.durable.state"
        const val STATE_PREFIX = "state."
        const val IDEMPOTENCY_PREFIX = "idempotency."
        const val PENDING_EVIDENCE = "pending_evidence"
        const val CONFIRMED_EVIDENCE = "confirmed_evidence"
        const val INBOX = "inbox"
        const val SYNC_CURSOR = "sync_cursor"
        const val WORKER_JOBS = "worker_jobs"
        const val MAX_CONFIRMED_EVIDENCE = 500
        const val MAX_INBOX_ITEMS = 250
        const val MAX_WORKER_JOBS = 100
    }
}
