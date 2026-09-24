package com.networkpeer.mobile.core.model

import kotlinx.serialization.Serializable
import kotlinx.serialization.SerialName
import kotlinx.serialization.json.JsonObject

@Serializable
data class ApiEnvelope<T>(
    val success: Boolean,
    val data: T? = null,
    val error: ApiError? = null,
)

@Serializable
data class ApiError(
    val code: String,
    val message: String,
)

class NetworkPeerApiException(
    val code: String,
    override val message: String,
    val statusCode: Int? = null,
) : IllegalStateException(message)

fun <T> ApiEnvelope<T>.requireData(): T =
    data.takeIf { success && it != null }
        ?: throw NetworkPeerApiException(error?.code ?: "REQUEST_FAILED", error?.message ?: "The request could not be completed")

@Serializable
enum class UserRole { CLIENT, WORKER, ADMIN }

@Serializable
enum class JobStatus {
    FUNDING,
    POSTED,
    ASSIGNED,
    EN_ROUTE,
    AT_LOCATION,
    IN_PROGRESS,
    SUBMITTED,
    APPROVED,
    COMPLETED,
    CANCELLED,
    DISPUTED,
}

@Serializable
enum class SubtaskStatus { PENDING, IN_PROGRESS, COMPLETED, SKIPPED }

@Serializable
enum class EscrowStatus { UNFUNDED, PENDING, HELD, RELEASED, FROZEN, REFUNDED }

@Serializable
enum class MediaType { IMAGE, VIDEO, AUDIO, DOCUMENT }

@Serializable
enum class MediaStatus { PENDING, UPLOADED, VERIFIED, REJECTED }

@Serializable
enum class PaymentOperationStatus { CREATED, PENDING, SUCCEEDED, FAILED, CANCELLED }

@Serializable
data class Point(
    val type: String = "Point",
    val coordinates: List<Double>,
) {
    init {
        require(coordinates.size == 2) { "A GeoJSON point needs [longitude, latitude]" }
    }

    companion object {
        fun fromLatitudeLongitude(latitude: Double, longitude: Double) = Point(coordinates = listOf(longitude, latitude))
    }
}

@Serializable
data class AuthUser(
    val id: String,
    val role: UserRole,
    val phone: String = "",
    val email: String? = null,
    @SerialName("full_name") val fullName: String = "",
    @SerialName("mobile_number") val mobileNumber: String? = null,
)

@Serializable
data class TokenPair(
    val access_token: String,
    val refresh_token: String,
    val expires_in: Long,
    val user: AuthUser,
)

@Serializable
data class StoredSession(
    val accessToken: String,
    val refreshToken: String,
    val expiresInSeconds: Long,
    val user: AuthUser,
) {
    companion object {
        fun from(pair: TokenPair) = StoredSession(
            accessToken = pair.access_token,
            refreshToken = pair.refresh_token,
            expiresInSeconds = pair.expires_in,
            user = pair.user,
        )
    }
}

@Serializable
data class OtpDelivery(
    val transport: String? = null,
    val to: String? = null,
)

@Serializable
data class OtpRequestResult(
    @SerialName("challenge_id") val challengeId: String = "",
    @SerialName("expires_in_seconds") val expiresInSeconds: Int = 300,
    @SerialName("otp_length") val otpLength: Int = 6,
    val delivery: OtpDelivery? = null,
    // The API calls this development_otp and sends it only when NODE_ENV is
    // not production. Declared as `otp` with no @SerialName, this never once
    // decoded, so the convenience it exists to provide was never available.
    @SerialName("development_otp") val developmentOtp: String? = null,
    val success: Boolean = true,
    val message: String = "",
)

@Serializable
data class Job(
    val id: String,
    val client_id: String,
    val worker_id: String? = null,
    val title: String,
    val description: String,
    val category: String,
    val status: JobStatus,
    val priority: Int,
    val budget_cents: Long,
    val platform_fee_cents: Long,
    val currency: String,
    val escrow_status: EscrowStatus,
    val funded_at: String? = null,
    val location: Point,
    val address: String? = null,
    val scheduled_at: String? = null,
    val started_at: String? = null,
    val completed_at: String? = null,
    val cancelled_at: String? = null,
    val cancellation_reason: String? = null,
    val metadata: JsonObject = JsonObject(emptyMap()),
    val created_at: String,
    val updated_at: String,
)

@Serializable
data class JobSubtask(
    val id: String,
    val job_id: String,
    val title: String,
    val description: String? = null,
    val sequence_order: Int,
    val is_required: Boolean,
    val status: SubtaskStatus,
    val completed_at: String? = null,
    val metadata: JsonObject = JsonObject(emptyMap()),
    val created_at: String,
    val updated_at: String,
)

@Serializable
data class WorkerJobSummary(
    val id: String,
    val title: String,
    val description: String,
    val category: String,
    val priority: Int,
    val budget_cents: Long,
    val currency: String,
    val scheduled_at: String? = null,
    val created_at: String,
    val distance_band: String,
    val capacity_mode: String? = null,
    val joined_workers: Int? = null,
)

@Serializable
data class WorkerJobDetail(
    val id: String,
    val title: String,
    val description: String,
    val category: String,
    val status: JobStatus,
    val priority: Int,
    val budget_cents: Long,
    val currency: String,
    val scheduled_at: String? = null,
    val created_at: String,
    val updated_at: String,
    val location: Point? = null,
    val address: String? = null,
    val is_assigned_to_requester: Boolean,
    val subtasks: List<JobSubtask>,
    val capacity_mode: String? = null,
    val joined_workers: Int? = null,
)


@Serializable
data class ClientJobDetail(
    val job: Job,
    val subtasks: List<JobSubtask>,
)

@Serializable
data class ClientJobPage(
    val items: List<Job>,
    val total: Int,
    val page: Int,
    val perPage: Int,
)

@Serializable
data class ClientJobCancellation(
    val job: Job,
    val cancelled: Boolean,
)

@Serializable
data class ClientJobResolution(
    val job: Job,
    val action: String,
)

@Serializable
data class EvidenceDownloadTarget(
    val url: String,
    val expires_at: String,
)

@Serializable
data class ClientEvidenceReviewItem(
    val id: String,
    val job_id: String,
    val subtask_id: String,
    val media_type: MediaType,
    val mime_type: String? = null,
    val file_size_bytes: Long? = null,
    val captured_at: String,
    val uploaded_at: String,
    val status: MediaStatus,
    val download: EvidenceDownloadTarget,
)

@Serializable
data class ClientEvidenceReviewResponse(val evidence: List<ClientEvidenceReviewItem>)

@Serializable
data class NearbyJobsPage(
    val items: List<WorkerJobSummary>,
    val page: Int,
    val perPage: Int,
    val radius_km: Int,
    val has_more: Boolean,
    val next_page: Int? = null,
)

@Serializable
data class WalletBalance(
    val currency: String,
    val availableBalanceCents: String,
    val pendingEscrowCents: String,
    val lifetimeEarningsCents: String,
    val lifetimeSpendCents: String,
)

@Serializable
data class WalletResponse(val balances: List<WalletBalance>)

@Serializable
data class FundingResult(
    val operationId: String,
    val ledgerTransactionId: String,
    val amountCents: String,
    val currency: String,
    val status: PaymentOperationStatus,
    val dispatchRequired: Boolean,
    val providerReference: String? = null,
    val clientSecret: String? = null,
)

@Serializable
data class ApprovalResult(
    val jobId: String,
    val status: JobStatus,
    val settlementLedgerTransactionId: String,
    val payoutOperationId: String,
    val payoutAmountCents: String,
    val currency: String,
    val payoutStatus: PaymentOperationStatus,
    val payoutProviderReference: String? = null,
    val payoutDispatchPending: Boolean,
)

@Serializable
data class EvidenceSummary(
    val id: String,
    val job_id: String,
    val subtask_id: String,
    val media_type: MediaType,
    val mime_type: String? = null,
    val file_size_bytes: Long? = null,
    val captured_at: String,
    val uploaded_at: String? = null,
    val status: MediaStatus,
)

@Serializable
data class EvidenceUploadTarget(
    val url: String,
    val fields: Map<String, String>,
    val expires_at: String,
)

@Serializable
data class EvidenceReservation(
    val evidence: EvidenceSummary,
    val upload: EvidenceUploadTarget? = null,
)

@Serializable
data class WorkStatusResult(
    val job_id: String,
    val status: JobStatus,
)

@Serializable
data class SubmitWorkResult(
    val job_id: String,
    val status: JobStatus,
)

@Serializable
data class SyncNotification(
    val id: String,
    val title: String,
    val body: String,
    val read_at: String? = null,
)

@Serializable
data class SyncEvent(
    val cursor: String,
    val event_id: String,
    val topic: String,
    val entity_type: String,
    val entity_id: String? = null,
    val payload: JsonObject = JsonObject(emptyMap()),
    val created_at: String,
    val notification: SyncNotification? = null,
)

@Serializable
data class SyncPage(
    val events: List<SyncEvent>,
    val has_more: Boolean,
    val next_cursor: String,
)

@Serializable
data class AppNotification(
    val id: String,
    val cursor: String,
    val topic: String,
    val title: String,
    val body: String,
    val data: JsonObject = JsonObject(emptyMap()),
    val read_at: String? = null,
    val created_at: String,
)

@Serializable
data class NotificationPage(
    val items: List<AppNotification>,
    val has_more: Boolean,
    val next_cursor: String? = null,
)

@Serializable
data class MarkAllNotificationsReadResult(val marked_count: Int)

@Serializable
data class WalletLedgerEntry(
    val id: String,
    val user_id: String,
    val job_id: String? = null,
    val transaction_type: String,
    val transaction_status: String,
    val amount_cents: Long,
    val balance_after_cents: Long,
    val currency: String,
    val reference_id: String? = null,
    val reference_type: String? = null,
    val description: String,
    val metadata: JsonObject = JsonObject(emptyMap()),
    val idempotency_key: String? = null,
    val processed_at: String? = null,
    val created_at: String,
)

@Serializable
data class WorkerSyncPage(
    val events: List<SyncEvent>,
    val jobs: List<WorkerJobDetail>,
    val snapshot_jobs: List<WorkerJobDetail>,
    val ledger_entries: List<WalletLedgerEntry>,
    val removed_job_ids: List<String>,
    val has_more: Boolean,
    val next_cursor: String,
)

@Serializable
data class DeviceRegistration(
    val id: String,
    val platform: String,
    val active: Boolean,
)

@Serializable
data class DeviceDeregistration(val deactivated: Boolean)

// Revision 2 Specification Models
@Serializable
enum class WorkerCapacityMode { single, capped, unlimited }

@Serializable
enum class WorkerRole { collectionist, correctionist }

@Serializable
data class JobCapacity(
    val mode: WorkerCapacityMode,
    val maxWorkers: Int? = null,
)

@Serializable
data class UnitOfWork(
    val kind: String,
    val totalUnits: Int? = null,
)

@Serializable
data class QualityMetric(
    val passed: Boolean,
    val score: Double,
    val message: String? = null,
)

@Serializable
data class QualityChecks(
    val edgeCoverage: QualityMetric,
    val sharpness: QualityMetric,
    val exposure: QualityMetric,
)

@Serializable
data class QualityCheckResult(
    val passed: Boolean,
    val checks: QualityChecks,
    val overallScore: Double,
    val engineVersion: String = "np-qa-v2",
    val ranOnDevice: Boolean = true,
    val checkedAt: String,
)

/**
 * Mirrors `OCRResult` in the API's contracts.ts, field for field.
 *
 * It previously carried four fields the server has never sent -- modelName,
 * detectedScript, hindiText, englishText -- and defaulted the others to
 * `confidence = 0.98`, `language = "hi+en"`, `detectedScript = "bilingual"`.
 * Those defaults were the problem: had a real result ever arrived without a
 * confidence, the app would have displayed 98% and declared the document
 * bilingual on no evidence at all. Nothing is defaulted now, so an absent
 * field reads as absent.
 */
@Serializable
data class OCRResult(
    val text: String,
    val confidence: Double? = null,
    val engineVersion: String? = null,
    val language: String? = null,
    val generatedAt: String? = null,
)

/**
 * The `ocr_status` field as the API actually reports it.
 *
 * Today every endpoint returns [UNAVAILABLE]: no OCR engine runs anywhere in
 * the system and no column stores a result. The other three exist in
 * contracts.ts and are handled here so the screens keep working unchanged on
 * the day one is switched on.
 */
enum class OcrStatus {
    UNAVAILABLE,
    PROCESSING,
    READY,
    FAILED,
    ;

    companion object {
        fun from(raw: String?): OcrStatus = when (raw?.lowercase()) {
            "ready" -> READY
            "processing" -> PROCESSING
            "failed" -> FAILED
            // An unrecognised value is not evidence that OCR succeeded.
            else -> UNAVAILABLE
        }
    }
}


@Serializable
data class ReviewEvent(
    val id: String,
    val submissionId: String,
    val reviewerRole: String,
    val reviewerId: String,
    val decision: String,
    val note: String? = null,
    val createdAt: String,
)

/** A time-limited link to evidence in S3. */
@Serializable
data class SignedMedia(
    val url: String,
    @SerialName("expires_at") val expiresAt: String? = null,
)

/**
 * One piece of evidence awaiting correctionist review.
 *
 * This is the response of `GET /worker/jobs/{jobId}/review-queue`, transcribed
 * from the handler that builds it rather than from the older contract type.
 *
 * The model it replaces could not decode that response at all. The server
 * sends snake_case (`job_id`, `captured_at`, `ocr_status`) while the model
 * declared camelCase with no @SerialName, and three of its fields -- unitRef,
 * mediaUrl, submittedAt -- were non-null with no default. Because the client's
 * Json is configured with `ignoreUnknownKeys = true`, every incoming key was
 * silently discarded and decoding then threw on the missing required fields.
 * The review queue has therefore never once loaded.
 */
@Serializable
data class ReviewQueueItem(
    val id: String,
    @SerialName("job_id") val jobId: String = "",
    @SerialName("subtask_id") val subtaskId: String? = null,
    @SerialName("worker_id") val workerId: String = "",
    @SerialName("media_type") val mediaType: MediaType = MediaType.IMAGE,
    @SerialName("mime_type") val mimeType: String? = null,
    @SerialName("file_size_bytes") val fileSizeBytes: Long? = null,
    @SerialName("captured_at") val capturedAt: String? = null,
    @SerialName("uploaded_at") val uploadedAt: String? = null,
    val status: String = "pending_review",
    @SerialName("verification_notes") val verificationNotes: String? = null,
    @SerialName("ocr_status") val ocrStatusRaw: String? = null,
    // No endpoint populates this yet. It is declared so the screen renders a
    // real transcript the day one does, rather than needing a change then.
    @SerialName("ocr_result") val ocrResult: OCRResult? = null,
    val media: SignedMedia? = null,
) {
    val ocrStatus: OcrStatus get() = OcrStatus.from(ocrStatusRaw)
}

@Serializable
data class ReviewQueueResponse(
    val submissions: List<ReviewQueueItem> = emptyList(),
)

@Serializable
data class WorkerSubmissionsResponse(
    val submissions: List<ReviewQueueItem> = emptyList(),
)

@Serializable
data class WorkerProfileData(
    val skills: List<String> = emptyList(),
    val hourlyRateCents: Int? = null,
    val rating: Double = 0.0,
    val totalJobsCompleted: Int = 0,
    val verificationStatus: String = "PENDING",
    val preferredRadiusKm: Int = 50,
    val isAvailable: Boolean = true,
    @SerialName("eligible_roles") val eligibleRoles: List<String> = emptyList(),
)

@Serializable
data class UserProfile(
    val id: String = "",
    @SerialName("phone_number") val phoneNumberSnake: String? = null,
    val phoneNumber: String = "",
    val phone: String? = null,
    @SerialName("mobile_number") val mobileNumberSnake: String? = null,
    val mobileNumber: String? = null,
    @SerialName("full_name") val fullNameSnake: String? = null,
    val fullName: String = "",
    val email: String? = null,
    val role: UserRole = UserRole.WORKER,
    @SerialName("eligible_roles") val eligibleRolesList: List<String>? = null,
    val eligibleRoles: List<String> = emptyList(),
    @SerialName("avatar_url") val avatarUrlSnake: String? = null,
    val avatarUrl: String? = null,
    @SerialName("is_active") val isActiveSnake: Boolean? = null,
    val isActive: Boolean = true,
    @SerialName("is_verified") val isVerifiedSnake: Boolean? = null,
    val isVerified: Boolean = false,
    @SerialName("created_at") val createdAtSnake: String? = null,
    val createdAt: String? = null,
    @SerialName("worker_profile") val workerProfileSnake: WorkerProfileData? = null,
    val workerProfile: WorkerProfileData? = null,
) {
    val displayPhone: String
        get() = mobileNumber ?: phoneNumber.ifEmpty { phone ?: phoneNumberSnake ?: mobileNumberSnake ?: "" }
    val displayName: String
        get() = fullName.ifEmpty { fullNameSnake ?: "Verified User" }
    val roles: List<String>
        get() = if (eligibleRoles.isNotEmpty()) eligibleRoles else (eligibleRolesList ?: emptyList())
}

@Serializable
data class UpdateProfileBody(
    @SerialName("full_name") val fullName: String? = null,
    @SerialName("mobile_number") val mobileNumber: String? = null,
    val email: String? = null,
    @SerialName("avatar_url") val avatarUrl: String? = null,
    val skills: List<String>? = null,
    @SerialName("preferred_radius_km") val preferredRadiusKm: Int? = null,
    @SerialName("is_available") val isAvailable: Boolean? = null,
)

fun Job.toWorkerJobSummary(): WorkerJobSummary = WorkerJobSummary(
    id = id,
    title = title,
    description = description,
    category = category,
    priority = priority,
    budget_cents = budget_cents,
    currency = currency,
    scheduled_at = scheduled_at,
    created_at = created_at,
    distance_band = "1_TO_5_KM",
)




